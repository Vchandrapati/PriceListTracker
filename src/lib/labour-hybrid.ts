export type Prior = { field_minutes: number | null; comm_minutes: number | null };

export type SectionInput = {
    id: string;
    name: string;
    quantity: number;
    counts: Record<string, number>;
};

export type JobInput = {
    numBuildings: number;
    paZoneCount: number;
    flags: Record<string, boolean>;
    decommissionRooms: number;
    paBuildingsDecommissioned: number;
    supplierFreightQuote: number;
    ewasteDisposalQuote: number;
};

export type CommercialAssumptions = Record<string, number>;

type Tree = {
    children_left: number[];
    children_right: number[];
    feature: number[];
    threshold: number[];
    value: number[];
};

type ModelBlock = {
    mu: number[];
    sigma: number[][];
    x_mean: number[];
    x_scale: number[];
    het_a_c: [number, number];
};

export type HybridArtifact = {
    config: { model_type: "random_forest_section_hybrid" };
    feature_columns: string[];
    field: {
        trees: Tree[];
        ratio_floor: number;
        ratio_ceiling: number;
        p65_multiplier: number;
        p80_multiplier: number;
    };
    allocator: {
        beta: number[];
        section_feature_names: string[];
        section_mean: Record<string, number>;
        section_scale: Record<string, number>;
        category_columns: string[];
        family_members: Record<string, string[]>;
    };
    commissioning: null | {
        columns: string[];
        comm: ModelBlock;
        gate: { intercept: number; coef: Record<string, number> };
        ratio_floor: number;
    };
};

export const BINARY_COLS = new Set(["is_education", "is_construction", "decommission", "scissor_lift"]);

export const DEVICE_COLS = [
    "cat01_displays_lt75", "cat02_displays_ge75", "cat03_projectors_ust", "cat04_whiteboards",
    "cat05_interactive_panels", "cat06_ceiling_projection", "cat21_projection_accessories",
    "cat07_ceiling_speakers", "cat08_wall_speakers", "cat09_amplifiers", "cat17_antennas",
    "cat18_wireless_mics", "cat10_control_interfaces", "cat11_dsp_processors", "cat12_uc_engines",
    "cat13_configurable_endpoints", "cat14_simple_extenders", "cat15_switchers_matrix",
    "cat16_cameras", "cat19_rack_count", "cat29_large_install", "cat30_small_install",
];

const GATE_COLS = ["cat12_uc_engines", "cat11_dsp_processors", "cat10_control_interfaces", "cat19_rack_count"];
const ceil4 = (hours: number) => Math.ceil(hours / 4) * 4;
const mround5 = (value: number) => Math.round(value / 5) * 5;
const nonNegative = (value: number | undefined) => Number.isFinite(value) && (value ?? 0) > 0 ? value ?? 0 : 0;

export function isVariation(section: SectionInput) {
    return /variation/i.test(section.name);
}

function treePredict(tree: Tree, features: number[]) {
    let node = 0;
    while (tree.children_left[node] !== -1) {
        node = features[tree.feature[node]] <= tree.threshold[node]
            ? tree.children_left[node]
            : tree.children_right[node];
    }
    return tree.value[node];
}

function forestPredict(trees: Tree[], features: number[]) {
    return trees.reduce((sum, tree) => sum + treePredict(tree, features), 0) / trees.length;
}

function modelQuantile(block: ModelBlock, xs: number[], logSize: number, priorHours: number, z: number, floor: number) {
    const vector = [1, ...xs];
    const mean = vector.reduce((sum, value, i) => sum + value * block.mu[i], 0);
    let parameterVariance = 0;
    for (let i = 0; i < vector.length; i++) {
        for (let j = 0; j < vector.length; j++) {
            parameterVariance += vector[i] * block.sigma[i][j] * vector[j];
        }
    }
    const [a, c] = block.het_a_c;
    const noise = Math.min(Math.max(Math.exp(a + c * logSize), 0.15 ** 2), 2.5 ** 2);
    return priorHours * Math.max(Math.exp(mean + z * Math.sqrt(Math.max(parameterVariance + noise, 0))), floor);
}

export function calculateHybrid(
    artifact: HybridArtifact,
    priors: Map<string, Prior>,
    commercial: CommercialAssumptions,
    sections: SectionInput[],
    job: JobInput,
) {
    const included = sections.filter((section) => !isVariation(section));
    const aggregate: Record<string, number> = {};
    for (const section of included) {
        for (const [key, value] of Object.entries(section.counts)) {
            aggregate[key] = (aggregate[key] ?? 0) + nonNegative(value);
        }
    }
    const rooms = included.reduce((sum, section) => sum + Math.max(1, nonNegative(section.quantity)), 0);
    aggregate.num_rooms = rooms;
    aggregate.num_buildings = nonNegative(job.numBuildings);
    aggregate.pa_zone_count = nonNegative(job.paZoneCount);
    for (const key of BINARY_COLS) aggregate[key] = job.flags[key] ? 1 : 0;

    const fieldMinutes = (key: string) => priors.get(key)?.field_minutes ?? 0;
    const commMinutes = (key: string) => priors.get(key)?.comm_minutes ?? 0;
    let fieldPriorMinutes = fieldMinutes("base") + rooms * fieldMinutes("per_room");
    let commPriorMinutes = commMinutes("base") + rooms * commMinutes("per_room");
    for (const [key, value] of Object.entries(aggregate)) {
        fieldPriorMinutes += value * fieldMinutes(key);
        commPriorMinutes += value * commMinutes(key);
    }
    fieldPriorMinutes += (aggregate.decommission ?? 0) * rooms * fieldMinutes("decommission_per_room");
    fieldPriorMinutes += (aggregate.is_construction ?? 0) * fieldMinutes("construction_adder");
    fieldPriorMinutes += (aggregate.scissor_lift ?? 0) * fieldMinutes("scissor_lift_adder");
    const fieldPriorHours = Math.max(fieldPriorMinutes / 60, 0.5);
    const commPriorHours = Math.max(commPriorMinutes / 60, 0.25);
    const deviceSize = DEVICE_COLS.reduce((sum, key) => sum + (aggregate[key] ?? 0), 0);

    const featureValues = artifact.feature_columns.map((key) => {
        if (key === "log_sheet_prior") return Math.log(fieldPriorHours);
        if (key === "log_device_size") return Math.log1p(deviceSize);
        const value = aggregate[key] ?? 0;
        return BINARY_COLS.has(key) ? value : Math.log1p(value);
    });
    const rawRatio = forestPredict(artifact.field.trees, featureValues);
    const ratio = Math.exp(Math.min(Math.max(rawRatio, Math.log(artifact.field.ratio_floor)), Math.log(artifact.field.ratio_ceiling)));
    const unroundedP50 = fieldPriorHours * ratio;
    const fieldP50 = ceil4(unroundedP50);
    const fieldP65 = ceil4(unroundedP50 * artifact.field.p65_multiplier);
    const fieldP80 = ceil4(unroundedP50 * artifact.field.p80_multiplier);

    const sectionWeights = included.map((section) => {
        const quantity = Math.max(1, nonNegative(section.quantity));
        let sectionPriorMinutes = quantity * fieldMinutes("per_room");
        for (const key of artifact.allocator.category_columns) {
            sectionPriorMinutes += nonNegative(section.counts[key]) * fieldMinutes(key);
        }
        const sectionPrior = Math.max(sectionPriorMinutes / 60, 0.05);
        const perRoom = (key: string) => nonNegative(section.counts[key]) / quantity;
        const raw: Record<string, number> = {
            log_section_quantity: Math.log(quantity),
            log_prior_per_room: Math.log(Math.max(sectionPrior / quantity, 0.05)),
            active_categories: artifact.allocator.category_columns.filter((key) => perRoom(key) > 0).length,
            blank_section_name: section.name.trim() === "" ? 1 : 0,
        };
        for (const [family, members] of Object.entries(artifact.allocator.family_members)) {
            raw[`log_${family}_per_room`] = Math.log1p(members.reduce((sum, key) => sum + perRoom(key), 0));
        }
        const standardised = artifact.allocator.section_feature_names.map((key) =>
            ((raw[key] ?? 0) - artifact.allocator.section_mean[key]) / artifact.allocator.section_scale[key]
        );
        const correction = artifact.allocator.beta[0] + standardised.reduce(
            (sum, value, i) => sum + value * artifact.allocator.beta[i + 1], 0
        );
        return { section, weight: sectionPrior * Math.exp(Math.min(Math.max(correction, -4), 4)) };
    });
    const weightTotal = sectionWeights.reduce((sum, row) => sum + row.weight, 0);
    const allocations = sectionWeights.map(({ section, weight }) => {
        const share = weightTotal > 0 ? weight / weightTotal : 1 / Math.max(sectionWeights.length, 1);
        return {
            id: section.id,
            name: section.name || "Untitled section",
            quantity: Math.max(1, section.quantity),
            share,
            p50: fieldP50 * share,
            p80: fieldP80 * share,
        };
    });
    // Users copy these values into section quotes.  Reconcile the displayed
    // tenths too, so copied section P50/P80 values still sum to the job total.
    for (const key of ["p50", "p80"] as const) {
        for (const row of allocations) row[key] = Math.round(row[key] * 10) / 10;
        if (allocations.length) {
            const displayedTotal = allocations.reduce((sum, row) => sum + row[key], 0);
            const largest = allocations.reduce((best, row) => row.share > best.share ? row : best);
            largest[key] = Math.round((largest[key] + (key === "p50" ? fieldP50 : fieldP80) - displayedTotal) * 10) / 10;
        }
    }

    let commP50 = ceil4(commPriorHours);
    let commP80 = ceil4(commPriorHours);
    let pAnyComm: number | null = null;
    if (artifact.commissioning) {
        const block = artifact.commissioning.comm;
        const xs = artifact.commissioning.columns.map((key, i) => {
            const raw = BINARY_COLS.has(key) ? aggregate[key] ?? 0 : Math.log1p(aggregate[key] ?? 0);
            return (raw - block.x_mean[i]) / block.x_scale[i];
        });
        commP50 = ceil4(modelQuantile(block, xs, Math.log1p(deviceSize), commPriorHours, 0, artifact.commissioning.ratio_floor));
        commP80 = ceil4(modelQuantile(block, xs, Math.log1p(deviceSize), commPriorHours, 0.84162, artifact.commissioning.ratio_floor));
        let logit = artifact.commissioning.gate.intercept;
        for (const key of GATE_COLS) logit += (artifact.commissioning.gate.coef[key] ?? 0) * Math.log1p(aggregate[key] ?? 0);
        pAnyComm = 1 / (1 + Math.exp(-logit));
    }

    // Commercial allowances are calculated once from the same non-Variation
    // whole-job aggregate as labour. Physical full trips are exposed for
    // planning; quarter-load equivalents allocate shared transport cost.
    const rate = (key: string) => {
        const value = commercial[key];
        if (!Number.isFinite(value)) throw new Error(`Missing commercial calculator assumption: ${key}`);
        return value;
    };
    const ceilTo = (value: number, increment: number) => Math.ceil(value / increment) * increment;
    const groupedCharge = (count: number, first: number, additional: number, capacity: number) => {
        if (count <= 0) return 0;
        const groups = Math.ceil(count / capacity);
        return groups * first + (count - groups) * additional;
    };
    const small = aggregate.cat30_small_install ?? 0;
    const large = aggregate.cat29_large_install ?? 0;
    const standardDisplays = (aggregate.cat01_displays_lt75 ?? 0) + (aggregate.cat02_displays_ge75 ?? 0);
    const ifps = aggregate.cat05_interactive_panels ?? 0;
    const whiteboards = aggregate.cat04_whiteboards ?? 0;
    const projectorScreens = aggregate.logistics_projector_screens ?? 0;
    const displayCapacity = rate("displays_per_pallet");
    const boxVolumeM3 = small * rate("small_box_volume_m3") + large * rate("large_box_volume_m3");
    const boxPallets = boxVolumeM3 > 0 ? Math.ceil(boxVolumeM3 / rate("pallet_volume_m3")) : 0;
    const displayPallets = (standardDisplays > 0 ? Math.ceil(standardDisplays / displayCapacity) : 0)
        + (ifps > 0 ? Math.ceil(ifps / displayCapacity) : 0);
    const totalPallets = boxPallets + displayPallets;
    const transportVolumeM3 = boxVolumeM3 + displayPallets * rate("pallet_volume_m3");
    const ldvLoadRatio = transportVolumeM3 / rate("ldv_usable_volume_m3");
    const allocatedLoadEquivalent = ceilTo(
        Math.max(ldvLoadRatio, rate("minimum_freight_load")), rate("load_allocation_increment"));
    const wholeLdvTrips = transportVolumeM3 > 0 ? Math.ceil(ldvLoadRatio) : 0;
    const specialtyFreight = groupedCharge(
        standardDisplays, rate("standard_display_first"), rate("standard_display_additional"), displayCapacity)
        + groupedCharge(ifps, rate("ifp_first"), rate("ifp_additional"), displayCapacity)
        + projectorScreens * rate("projector_screen_flat")
        + whiteboards * rate("whiteboard_flat");
    const freightInternal = mround5(Math.max(
        allocatedLoadEquivalent * rate("internal_return_trip_cost")
        + small * rate("freight_handling_small") + large * rate("freight_handling_large")
        + rate("freight_consolidation")
        + small * rate("freight_overhead_small") + large * rate("freight_overhead_large")
        + specialtyFreight,
        rate("freight_floor"),
    ));
    const supplierFreightQuote = nonNegative(job.supplierFreightQuote);
    const freight = freightInternal + supplierFreightQuote;

    const durationDays = Math.ceil((fieldP50 / 16) / 0.5) * 0.5;
    const storageDays = Math.ceil(durationDays * rate("storage_days_share"));
    const displayStorageCount = standardDisplays + ifps + whiteboards + projectorScreens;
    const dailyBoxStorage = durationDays > rate("short_job_days")
        ? boxPallets * rate("pallet_daily")
        : (boxVolumeM3 > 0 ? rate("small_shelf_daily") : 0);
    const storage = mround5(Math.max(
        (dailyBoxStorage + displayStorageCount * rate("display_slot_daily")) * storageDays,
        rate("storage_floor"),
    ));

    const packagingWasteLoadEquivalent = ldvLoadRatio * rate("packaging_compaction_factor");
    const wasteTripEquivalent = ceilTo(
        Math.max(packagingWasteLoadEquivalent, rate("minimum_waste_load")), rate("load_allocation_increment"));
    const decommissionRooms = nonNegative(job.decommissionRooms);
    const paBuildingsDecommissioned = nonNegative(job.paBuildingsDecommissioned);
    const ewasteItems = decommissionRooms * rate("ewaste_items_per_room")
        + paBuildingsDecommissioned * rate("ewaste_items_per_pa_building");
    const ewasteLoadRatio = ewasteItems * rate("small_box_volume_m3") / rate("ldv_usable_volume_m3");
    const ewasteTripEquivalent = ewasteItems > 0
        ? ceilTo(Math.max(ewasteLoadRatio, rate("minimum_waste_load")), rate("load_allocation_increment"))
        : 0;
    const ewasteBatch = ewasteItems > 0
        ? rate("ewaste_temporary_pallet")
            + ewasteItems * rate("ewaste_processing_minutes") / 60 * rate("warehouse_labor_hourly")
            + rate("ewaste_batch_minutes") / 60 * rate("warehouse_labor_hourly")
        : 0;
    const wasteInternal = mround5(Math.max(
        wasteTripEquivalent * rate("internal_return_trip_cost")
        + small * (rate("waste_processing_small") + rate("waste_loading_small") + rate("waste_overhead_small"))
        + large * (rate("waste_processing_large") + rate("waste_loading_large") + rate("waste_overhead_large"))
        + ewasteTripEquivalent * rate("internal_return_trip_cost") + ewasteBatch,
        rate("waste_floor"),
    ));
    const ewasteDisposalQuote = nonNegative(job.ewasteDisposalQuote);
    const waste = wasteInternal + ewasteDisposalQuote;

    return {
        includedSectionCount: included.length,
        excludedVariationCount: sections.length - included.length,
        fieldPriorHours,
        fieldP50,
        fieldP65,
        fieldP80,
        commP50,
        commP80,
        pAnyComm,
        allocations,
        projectCallout: (fieldP50 + commP50) / 8,
        boxVolumeM3,
        boxPallets,
        displayPallets,
        totalPallets,
        transportVolumeM3,
        ldvLoadRatio,
        allocatedLoadEquivalent,
        wholeLdvTrips,
        specialtyFreight,
        freightInternal,
        supplierFreightQuote,
        freight,
        storageDays,
        storage,
        packagingWasteLoadEquivalent,
        wasteTripEquivalent,
        ewasteItems,
        ewasteTripEquivalent,
        wasteInternal,
        ewasteDisposalQuote,
        waste,
    };
}
