import _ from "lodash";
import { useCallback } from "react";
import {
    ObjectsListProps,
    TableConfig,
    TablePagination,
    TableSorting,
    useObjectsTable,
} from "@eyeseetea/d2-ui-components";
import { CsvWriterDataSource } from "../../../data/common/CsvWriterCsvDataSource";
import { downloadFile } from "../../../data/common/utils/download-file";

type Row = { id: string };

/**
 * An ObjectsList over rows already in memory. Search, sort and paging happen here, and "select
 * all" covers every matching row rather than just the visible page, which bulk actions rely on.
 */
export function useInMemoryTable<T extends Row>(
    config: TableConfig<T>,
    rows: T[],
    matches: (row: T, search: string) => boolean
): ObjectsListProps<T> {
    const filter = useCallback(
        (search: string) => {
            const query = search.trim().toLowerCase();
            return query ? rows.filter(row => matches(row, query)) : rows;
        },
        [rows, matches]
    );

    const getRows = useCallback(
        async (search: string, paging: TablePagination, sorting: TableSorting<T>) => {
            const filtered = filter(search);
            // Sorted before slicing, so paging walks the whole ordered list, not one page of it.
            const sorted = _.orderBy(filtered, [row => sortable(row[sorting.field])], [sorting.order]);

            return {
                objects: sorted.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize),
                pager: {
                    page: paging.page,
                    pageSize: paging.pageSize,
                    total: filtered.length,
                    pageCount: Math.max(1, Math.ceil(filtered.length / paging.pageSize)),
                },
            };
        },
        [filter]
    );

    const getAllIds = useCallback(async (search: string) => filter(search).map(row => row.id), [filter]);

    return useObjectsTable<T>(config, getRows, getAllIds);
}

function sortable(value: unknown): string | number {
    if (typeof value === "number") return value;
    return String(value ?? "").toLowerCase();
}

export function includesText(query: string, ...values: (string | undefined)[]): boolean {
    return values.some(value => (value ?? "").toLowerCase().includes(query));
}

export async function downloadCsv(filename: string, headers: string[], rows: Record<string, string | number>[]) {
    const csv = new CsvWriterDataSource().toString({
        headers: headers.map(header => ({ id: header, text: header })),
        rows: rows.map(row => _.mapValues(row, value => String(value ?? ""))),
    });
    await downloadFile(csv, filename, "text/csv");
}

/**
 * Emails joined with semicolons, which Outlook accepts pasted straight into the To field.
 * Duplicates and blanks are dropped so each person is written to once.
 */
export async function copyEmails(emails: string[]): Promise<number> {
    const unique = _.uniqBy(
        emails.map(email => email.trim()).filter(email => email),
        email => email.toLowerCase()
    );
    await navigator.clipboard.writeText(unique.join("; "));
    return unique.length;
}
