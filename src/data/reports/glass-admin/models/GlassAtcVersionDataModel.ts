import {
    ATCChangesData,
    ATCData,
    AmClassification,
    AmClassificationData,
    AmMapping,
    AtcDddIndexData,
    AwareClassification,
    AwareClassificationData,
    AwareMapping,
    CombinationsData,
    ConversionsDDDToGramsData,
    ConversionsIUToGramsData,
    DDDChangesData,
    DDDData,
    RoasData,
    SaltsData,
    UnitsData,
} from "../../../../domain/reports/glass-admin/entities/GlassAtcVersionData";
import { Codec, Schema } from "../../../../utils/codec";

const ATCDataModel: Codec<ATCData> = Schema.object({
    CODE: Schema.string,
    NAME: Schema.string,
    LEVEL: Schema.number,
    PATH: Schema.string,
});

const DDDDataModel: Codec<DDDData> = Schema.object({
    ARS: Schema.string,
    ATC5: Schema.string,
    ROA: Schema.string,
    SALT: Schema.string,
    DDD: Schema.number,
    DDD_UNIT: Schema.string,
    DDD_GRAMS: Schema.nullable(Schema.number),
    DDD_STD: Schema.number,
    NOTES: Schema.nullable(Schema.string),
});

const CombinationsDataModel: Codec<CombinationsData> = Schema.object({
    COMB_CODE: Schema.string,
    ARS: Schema.string,
    ATC5: Schema.string,
    FORM: Schema.string,
    ROA: Schema.string,
    UNIT_DOSE: Schema.string,
    DDD: Schema.number,
    DDD_UNIT: Schema.string,
    DDD_INFO: Schema.string,
    EXAMPLES: Schema.string,
    DDD_GRAMS: Schema.number,
    MULTIFORM: Schema.boolean,
    UD_GRAMS: Schema.nullable(Schema.number),
});

const ConversionsIUToGramsDataModel: Codec<ConversionsIUToGramsData> = Schema.object({
    ARS: Schema.string,
    ATC5: Schema.string,
    ROA: Schema.string,
    UNIT_FROM: Schema.string,
    UNIT_TO: Schema.exact("G"),
    FACTOR: Schema.number,
    SALT: Schema.string,
});

const ConversionsDDDToGramsDataModel: Codec<ConversionsDDDToGramsData> = Schema.object({
    ATC5: Schema.string,
    DDD_GRAM_UNIT: Schema.nullable(Schema.exact("G")),
    DDD_GRAM_VALUE: Schema.nullable(Schema.number),
    INFO: Schema.nullable(Schema.string),
    ROA: Schema.string,
});

const DDDChangesDataModel: Codec<DDDChangesData> = Schema.object({
    CATEGORY: Schema.exact("DDD"),
    ATC_CODE: Schema.string,
    CHANGE: Schema.string,
    NEW_DDD_INFO: Schema.nullable(Schema.string),
    NEW_DDD_ROA: Schema.string,
    NEW_DDD_UNIT: Schema.string,
    NEW_DDD_VALUE: Schema.number,
    PREVIOUS_DDD_INFO: Schema.nullable(Schema.string),
    PREVIOUS_DDD_ROA: Schema.string,
    PREVIOUS_DDD_UNIT: Schema.string,
    PREVIOUS_DDD_VALUE: Schema.number,
    YEAR: Schema.number,
});

const ATCChangesDataModel: Codec<ATCChangesData> = Schema.object({
    CATEGORY: Schema.exact("ATC"),
    CHANGE: Schema.string,
    INFO: Schema.nullable(Schema.string),
    NEW_ATC: Schema.string,
    NEW_NAME: Schema.nullable(Schema.string),
    PREVIOUS_ATC: Schema.string,
    SUBSTANCE_NAME: Schema.nullable(Schema.string),
    YEAR: Schema.number,
});

const SaltsDataModel: Codec<SaltsData> = Schema.object({
    CODE: Schema.string,
    INFO: Schema.string,
    NAME: Schema.string,
});

const RoasDataModel: Codec<RoasData> = Schema.object({
    CODE: Schema.string,
    NAME: Schema.string,
});

const UnitsDataModel: Codec<UnitsData> = Schema.object({
    BASE_CONV: Schema.number,
    UNIT: Schema.string,
    NAME: Schema.string,
    UNIT_STD: Schema.string,
    USE_STRENGTH: Schema.boolean,
    USE_VOLUME: Schema.boolean,
});

const AmClassificationModel: Codec<AmClassification> = Schema.object({
    CODE: Schema.string,
    NAME: Schema.string,
});

const AmMappingModel: Codec<AmMapping> = Schema.object({
    ATCS: Schema.array(Schema.string),
    CODE: Schema.string,
});

const AwareClassificationModel: Codec<AwareClassification> = Schema.object({
    CODE: Schema.string,
    NAME: Schema.string,
});

const AwareMappingModel: Codec<AwareMapping> = Schema.object({
    ATC5: Schema.string,
    AWR: Schema.string,
    EML: Schema.string,
    ROA: Schema.nullable(Schema.string),
});

export const AtcDddIndexDataModel: Codec<AtcDddIndexData> = Schema.object({
    atcs: Schema.array(ATCDataModel),
    ddds: Schema.array(DDDDataModel),
    combinations: Schema.array(CombinationsDataModel),
    conversions_iu_g: Schema.array(ConversionsIUToGramsDataModel),
    conversions_ddd_g: Schema.array(ConversionsDDDToGramsDataModel),
    changes: Schema.array(Schema.oneOf([ATCChangesDataModel, DDDChangesDataModel])),
    salts: Schema.array(SaltsDataModel),
    roas: Schema.array(RoasDataModel),
    units: Schema.array(UnitsDataModel),
});

export const AwareClassificationDataModel: Codec<AwareClassificationData> = Schema.object({
    classification: Schema.array(AwareClassificationModel),
    atc_awr_mapping: Schema.array(AwareMappingModel),
});
export const AmClassificationDataModel: Codec<AmClassificationData> = Schema.object({
    classification: Schema.array(AmClassificationModel),
    atc_am_mapping: Schema.array(AmMappingModel),
});
