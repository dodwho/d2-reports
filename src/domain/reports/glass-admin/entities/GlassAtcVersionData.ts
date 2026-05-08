import {
    AtcDddIndexDataModel,
    AmClassificationDataModel,
    AwareClassificationDataModel,
} from "../../../../data/reports/glass-admin/models/GlassAtcVersionDataModel";

type ATCCodeLevel5 = string;

type RouteOfAdministrationCode = string;
type RouteOfAdministrationName = string;

type UnitCode = string;
type UnitName = string;
type UnitSTDName = string;

type SaltCode = string;
type SaltName = string;

export type ATCData = {
    CODE: string;
    NAME: string;
    LEVEL: number;
    PATH: string;
};

export type DDDData = {
    ARS: string;
    ATC5: ATCCodeLevel5;
    ROA: RouteOfAdministrationCode;
    SALT: SaltCode;
    DDD: number;
    DDD_UNIT: UnitCode;
    DDD_STD: number;
    DDD_GRAMS: number | null;
    NOTES: string | null;
};

export type CombinationsData = {
    COMB_CODE: string;
    ARS: string;
    ATC5: ATCCodeLevel5;
    FORM: string;
    ROA: RouteOfAdministrationCode;
    UNIT_DOSE: string;
    DDD: number;
    DDD_UNIT: UnitCode;
    DDD_INFO: string;
    EXAMPLES: string;
    DDD_GRAMS: number;
    MULTIFORM: boolean;
    UD_GRAMS: number | null;
};

export type ConversionsIUToGramsData = {
    ARS: string;
    ATC5: ATCCodeLevel5;
    ROA: RouteOfAdministrationCode;
    UNIT_FROM: UnitCode;
    UNIT_TO: "G";
    FACTOR: number;
    SALT: SaltCode;
};

export type ConversionsDDDToGramsData = {
    ATC5: ATCCodeLevel5;
    DDD_GRAM_UNIT: "G" | null;
    DDD_GRAM_VALUE: number | null;
    INFO: string | null;
    ROA: RouteOfAdministrationCode;
};

type ATCAndDDDChangesData = ATCChangesData | DDDChangesData;

export type DDDChangesData = {
    CATEGORY: "DDD";
    ATC_CODE: ATCCodeLevel5;
    CHANGE: string;
    NEW_DDD_INFO: string | null;
    NEW_DDD_ROA: RouteOfAdministrationCode;
    NEW_DDD_UNIT: UnitCode;
    NEW_DDD_VALUE: number;
    PREVIOUS_DDD_INFO: string | null;
    PREVIOUS_DDD_ROA: RouteOfAdministrationCode;
    PREVIOUS_DDD_UNIT: UnitCode;
    PREVIOUS_DDD_VALUE: number;
    YEAR: number;
};

export type ATCChangesData = {
    CATEGORY: "ATC";
    CHANGE: string;
    INFO: string | null;
    NEW_ATC: ATCCodeLevel5;
    NEW_NAME: string | null;
    PREVIOUS_ATC: ATCCodeLevel5;
    SUBSTANCE_NAME: string | null;
    YEAR: number;
};

export type SaltsData = {
    CODE: SaltCode;
    INFO: string;
    NAME: SaltName;
};

export type RoasData = {
    CODE: RouteOfAdministrationCode;
    NAME: RouteOfAdministrationName;
};

export type UnitsData = {
    BASE_CONV: number;
    UNIT: UnitCode;
    NAME: UnitName;
    UNIT_STD: UnitSTDName;
    USE_STRENGTH: boolean;
    USE_VOLUME: boolean;
};

type AmCode = string;
type AmName = string;

type AwrCode = string;
type AwrName = string;

export type AmClassification = {
    CODE: AmCode;
    NAME: AmName;
};

export type AmMapping = {
    ATCS: string[];
    CODE: AmCode;
};

export type AwareClassification = {
    CODE: AwrCode;
    NAME: AwrName;
};

export type AwareMapping = {
    ATC5: ATCCodeLevel5;
    AWR: AwrCode;
    EML: string;
    ROA: string | null;
};

const ATC_DDD_INDEX: (keyof AtcDddIndexData)[] = [
    "atcs",
    "ddds",
    "combinations",
    "changes",
    "conversions_iu_g",
    "conversions_ddd_g",
    "salts",
    "roas",
    "units",
];

export type AtcDddIndexData = {
    atcs: ATCData[];
    ddds: DDDData[];
    combinations: CombinationsData[];
    conversions_iu_g: ConversionsIUToGramsData[];
    conversions_ddd_g: ConversionsDDDToGramsData[];
    changes: ATCAndDDDChangesData[];
    salts: SaltsData[];
    roas: RoasData[];
    units: UnitsData[];
};

const AWARE_KEYS: (keyof AwareClassificationData)[] = ["classification", "atc_awr_mapping"];

export type AwareClassificationData = {
    classification: AwareClassification[];
    atc_awr_mapping: AwareMapping[];
};

const AM_KEYS: (keyof AmClassificationData)[] = ["classification", "atc_am_mapping"];

export type AmClassificationData = {
    classification: AmClassification[];
    atc_am_mapping: AmMapping[];
};

export type GlassAtcVersionData = AtcDddIndexData & {
    am_classification: AmClassificationData;
    aware_classification: AwareClassificationData;
};

function areRequiredJsonsIncluded(data: Record<string, unknown[]>[]): boolean {
    const maybeAtcDddIndexData = data.find(dataItem => ATC_DDD_INDEX.every(key => Object.keys(dataItem).includes(key)));
    const maybeAmClassificationData = data.find(dataItem => AM_KEYS.every(key => Object.keys(dataItem).includes(key)));
    const maybeAwareClassificationData = data.find(dataItem =>
        AWARE_KEYS.every(key => Object.keys(dataItem).includes(key))
    );

    return data.length === 3 && !!maybeAtcDddIndexData && !!maybeAmClassificationData && !!maybeAwareClassificationData;
}

function getAtcDddIndexDataFromJson(data: Record<string, unknown[]>[]): AtcDddIndexData {
    const maybeAtcDddIndexData = data.find(dataItem => ATC_DDD_INDEX.every(key => Object.keys(dataItem).includes(key)));

    const atcDddIndexDataValidated = AtcDddIndexDataModel.decode(maybeAtcDddIndexData);

    if (atcDddIndexDataValidated.isLeft()) {
        throw new Error(atcDddIndexDataValidated.extract());
    }

    const maybeAtcDddIndexDataValidated = atcDddIndexDataValidated.toMaybe().extract();
    if (maybeAtcDddIndexDataValidated) return maybeAtcDddIndexDataValidated;

    throw Error(
        "ATC and DDD index data is not valid. Should contain atcs, ddds ,combinations, changes, conversions_iu_g, conversions_ddd_g, salts, roas, units"
    );
}

function getAmClassificationDataFromJson(data: Record<string, unknown[]>[]): AmClassificationData {
    const maybeAmClassificationData = data.find(dataItem => AM_KEYS.every(key => Object.keys(dataItem).includes(key)));

    const amClassificationDataValidated = AmClassificationDataModel.decode(maybeAmClassificationData);

    if (amClassificationDataValidated.isLeft()) {
        throw new Error(amClassificationDataValidated.extract());
    }

    const maybeAmClassificationDataValidated = amClassificationDataValidated.toMaybe().extract();
    if (maybeAmClassificationDataValidated) return maybeAmClassificationDataValidated;

    throw Error("Am Classification data is not valid. Should contain classification and atc_am_mapping");
}

function getAwareClassificationDataFromJson(data: Record<string, unknown[]>[]): AwareClassificationData {
    const maybeAwareClassificationData = data.find(dataItem =>
        AWARE_KEYS.every(key => Object.keys(dataItem).includes(key))
    );

    const awareClassificationDataValidated = AwareClassificationDataModel.decode(maybeAwareClassificationData);

    if (awareClassificationDataValidated.isLeft()) {
        throw new Error(awareClassificationDataValidated.extract());
    }

    const maybeAwareClassificationDataValidated = awareClassificationDataValidated.toMaybe().extract();
    if (maybeAwareClassificationDataValidated) return maybeAwareClassificationDataValidated;

    throw Error("Aware Classification data is not valid. Should contain classification and atc_awr_mapping");
}

export function getGlassAtcVersionData(data: Record<string, unknown[]>[]): GlassAtcVersionData {
    if (areRequiredJsonsIncluded(data)) {
        const atcDddIndexData = getAtcDddIndexDataFromJson(data);
        const amClassification = getAmClassificationDataFromJson(data);
        const awareClassification = getAwareClassificationDataFromJson(data);
        const t = {
            ...atcDddIndexData,
            am_classification: amClassification,
            aware_classification: awareClassification,
        };
        return t;
    }
    throw Error(
        "ATC data is not valid. File should contain atc_ddd_index.json, aware_classification.json, and am_classification.json"
    );
}
