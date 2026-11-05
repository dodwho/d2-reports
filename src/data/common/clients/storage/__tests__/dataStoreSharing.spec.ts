import { copyDataStoreSharing, DataStoreSharing, SharingApi } from "../dataStoreSharing";

const locked: DataStoreSharing = {
    publicAccess: "r-------",
    externalAccess: false,
    userAccesses: [],
    userGroupAccesses: [{ id: "sVbZXz6W0oQ", access: "rw------" }],
};

const open: DataStoreSharing = { ...locked, publicAccess: "rw------", userGroupAccesses: [] };

/** In-memory /dataStore/<ns>/<key>/metaData and /sharing; `ignorePut` mimics a server that answers OK but keeps the old sharing. */
function fakeApi(sharingById: Record<string, object>, ignorePut = false) {
    const ids: Record<string, string> = {
        "/dataStore/glass/ATCs/metaData": "idATCs",
        "/dataStore/glass/ATC-2026-v2/metaData": "idNew",
    };
    const puts: unknown[] = [];
    const response = (data: unknown) => ({ getData: () => Promise.resolve(data) });

    const api = {
        get: (url: string, params?: { id: string }) =>
            response(url === "/sharing" ? { object: sharingById[params?.id ?? ""] } : { id: ids[url] }),
        put: (url: string, params: { id: string }, data: { object: object }) => {
            puts.push({ url, params, data });
            if (!ignorePut) sharingById[params.id] = data.object;
            return response({});
        },
    };
    return { api: api as unknown as SharingApi, puts, sharingById };
}

describe("copyDataStoreSharing", () => {
    it("puts the sharing of the locked key on the new key", async () => {
        const { api, puts, sharingById } = fakeApi({ idATCs: locked, idNew: open });

        await copyDataStoreSharing(api, "glass", "ATCs", "ATC-2026-v2");

        expect(puts).toEqual([
            { url: "/sharing", params: { type: "dataStore", id: "idNew" }, data: { object: locked } },
        ]);
        expect(sharingById["idNew"]).toEqual(locked);
    });

    it("sends only the writable fields, with ids sorted", async () => {
        const fromServer = {
            ...locked,
            name: "ATCs",
            userGroupAccesses: [
                { id: "zGroup", access: "r-------", displayName: "Z" },
                { id: "aGroup", access: "rw------", displayName: "A" },
            ],
        };
        const { api, puts } = fakeApi({ idATCs: fromServer, idNew: open });

        await copyDataStoreSharing(api, "glass", "ATCs", "ATC-2026-v2");

        expect(puts).toHaveLength(1);
        expect((puts[0] as { data: { object: DataStoreSharing } }).data.object.userGroupAccesses).toEqual([
            { id: "aGroup", access: "rw------" },
            { id: "zGroup", access: "r-------" },
        ]);
    });

    it("fails when the new key still has other sharing after the save", async () => {
        const { api } = fakeApi({ idATCs: locked, idNew: open }, true);

        await expect(copyDataStoreSharing(api, "glass", "ATCs", "ATC-2026-v2")).rejects.toThrow(
            "The sharing of glass/ATC-2026-v2 was not saved like glass/ATCs"
        );
    });
});
