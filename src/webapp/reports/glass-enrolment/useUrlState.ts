import { useCallback, useState } from "react";

export const tabs = ["countries", "map", "contacts", "gaps", "health", "history"] as const;
export type Tab = typeof tabs[number];

export type UrlState = {
    tab: Tab;
    region: string;
    module: string;
    status: string;
    q: string;
    /** The country whose panel is open. */
    country: string;
};

const keys: (keyof UrlState)[] = ["tab", "region", "module", "status", "q", "country"];

function read(): UrlState {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as Tab | null;

    return {
        tab: tab && tabs.includes(tab) ? tab : "countries",
        region: params.get("region") ?? "",
        module: params.get("module") ?? "",
        status: params.get("status") ?? "",
        q: params.get("q") ?? "",
        country: params.get("country") ?? "",
    };
}

/**
 * The view lives in the address bar, so copying the link shares exactly what is on screen — a
 * region, a module filter, an open country — and the browser's reload keeps it.
 */
export function useUrlState(): [UrlState, (patch: Partial<UrlState>) => void] {
    const [state, setState] = useState(read);

    const update = useCallback((patch: Partial<UrlState>) => {
        setState(current => {
            const next = { ...current, ...patch };
            const params = new URLSearchParams(window.location.search);

            keys.forEach(key => {
                const value = next[key];
                if (value && !(key === "tab" && value === "countries")) params.set(key, value);
                else params.delete(key);
            });

            const search = params.toString();
            window.history.replaceState(
                null,
                "",
                `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
            );
            return next;
        });
    }, []);

    return [state, update];
}
