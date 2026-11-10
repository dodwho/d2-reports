export type SubmissionsStoreSetting = "datastore" | "program";

/** `dataSubmissionsStore` in `glass/general`: missing means the DataStore; an unknown value is an error, never a silent default. */
export function submissionsStoreSetting(value: string | undefined): SubmissionsStoreSetting {
    const setting = value ?? "datastore";
    if (setting === "datastore" || setting === "program") return setting;
    throw new Error(`Unknown dataSubmissionsStore "${setting}" in the general settings`);
}
