import { Id } from "../../../domain/common/entities/Base";
import { ContactDetails } from "../../../domain/reports/glass-enrolment/entities/Enrolment";

/**
 * Metadata ids for the GLASS country enrolment program ("AMR - Focal Point").
 *
 * The program id itself is read from the `glass/general` datastore key's `enrolmentProgram` field,
 * which GLASS already declares; this constant is only the fallback for an instance whose key
 * predates that field. The remaining ids are fixed metadata with no datastore equivalent.
 */
export const DEFAULT_ENROLMENT_PROGRAM_ID = "oo0bqS0AqMI";

/** Tracked entity attribute AMR_MODULE, bound to the "Module" option set. */
export const ENROLMENT_MODULE_ATTRIBUTE_ID = "Fh6atHPjdxC";

/**
 * The value stored in the module attribute for each module: the code of its option in the "Module"
 * option set. Keyed by the module name as the `glass/modules` datastore key spells it.
 */
export const MODULE_ENROLMENT_CODES: Record<string, string> = {
    AMR: "AMR",
    "AMR - Individual": "AMR_INDIVIDUAL",
    "AMR - Fungal": "AMR_FUNGAL",
    AMC: "AMC",
    EGASP: "EGASP",
    EAR: "EAR",
};

/** Data elements of the "National Focal Point" program stage — all ten of them. */
export const FOCAL_POINT_DATA_ELEMENTS: Record<Exclude<keyof ContactDetails, "startDate">, Id> = {
    familyName: "GXDSEwgeGwK",
    firstName: "Z9fUYlB1HmQ",
    function: "EVKMO195LMe",
    email: "CgCPexj0q43",
    language: "h6okeC9Fh0r",
    telephone: "I2UOcdFIvUq",
    institution: "RM1V3aPr5Lc",
    address: "YJEnWwlhx78",
    city: "Fc2Zy5r7Hz4",
    zipCode: "Kx1ErRIlfYi",
};

/**
 * Datastore namespace for the change history, one key per recorded action. A namespace of its own
 * keeps the growing log out of `glass`, whose keys the GLASS app reads as configuration.
 */
export const HISTORY_NAMESPACE = "glass-enrolment-history";
