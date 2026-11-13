import _ from "lodash";
import { D2Api } from "../../../../types/d2-api";

type Access = { id: string; access: string };

export interface DataStoreSharing {
    publicAccess: string;
    externalAccess: boolean;
    userAccesses: Access[];
    userGroupAccesses: Access[];
}

export type SharingApi = Pick<D2Api, "get" | "put">;

/**
 * Gives a DataStore key the sharing of another key in the same namespace, then reads it back.
 * A key created through the API gets the instance default sharing, which on the WHO instance lets every
 * logged-in user overwrite it, so a new key must take the sharing of a key that is already locked.
 */
export async function copyDataStoreSharing(
    api: SharingApi,
    namespace: string,
    fromKey: string,
    toKey: string
): Promise<void> {
    const sharing = await getSharing(api, await getEntryId(api, namespace, fromKey));
    await setDataStoreSharing(api, namespace, toKey, sharing);
}

/** Sets a DataStore key's sharing, then reads it back; throws if the server did not keep it. */
export async function setDataStoreSharing(
    api: SharingApi,
    namespace: string,
    key: string,
    sharing: DataStoreSharing
): Promise<void> {
    const id = await getEntryId(api, namespace, key);
    const wanted = {
        ...sharing,
        userAccesses: toAccesses(sharing.userAccesses),
        userGroupAccesses: toAccesses(sharing.userGroupAccesses),
    };
    await api.put("/sharing", { type: "dataStore", id }, { object: wanted }).getData();

    const saved = await getSharing(api, id);
    if (!_.isEqual(saved, wanted)) {
        throw new Error(`The sharing of ${namespace}/${key} was not saved`);
    }
}

async function getEntryId(api: SharingApi, namespace: string, key: string): Promise<string> {
    const { id } = await api.get<{ id: string }>(`/dataStore/${namespace}/${key}/metaData`).getData();
    return id;
}

async function getSharing(api: SharingApi, id: string): Promise<DataStoreSharing> {
    const { object } = await api
        .get<{ object: Partial<DataStoreSharing> }>("/sharing", { type: "dataStore", id })
        .getData();

    return {
        publicAccess: object.publicAccess ?? "--------",
        externalAccess: Boolean(object.externalAccess),
        userAccesses: toAccesses(object.userAccesses),
        userGroupAccesses: toAccesses(object.userGroupAccesses),
    };
}

function toAccesses(accesses: Access[] = []): Access[] {
    return _.sortBy(
        accesses.map(({ id, access }) => ({ id, access })),
        access => access.id
    );
}
