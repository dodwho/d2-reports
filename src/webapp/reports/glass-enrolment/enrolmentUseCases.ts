import { D2Api } from "../../../types/d2-api";
import { EnrolmentD2Repository } from "../../../data/reports/glass-enrolment/EnrolmentD2Repository";
import {
    ApplyChangeUseCase,
    ChangeRequest,
    GetAccessUseCase,
    GetGeometriesUseCase,
    GetHistoryUseCase,
    GetModulesUseCase,
    GetSnapshotUseCase,
    ValidateChangeUseCase,
} from "../../../domain/reports/glass-enrolment/usecases/EnrolmentUseCases";
import { ChangeSet } from "../../../domain/reports/glass-enrolment/entities/ChangeSet";
import { GlassModule } from "../../../domain/reports/glass-enrolment/entities/Enrolment";

/**
 * This report's own wiring, kept out of the shared composition root on purpose. Everything here is
 * reached only through the lazily loaded report, so no other d2-reports variant bundles or runs a
 * line of it.
 */
export function getEnrolmentUseCases(api: D2Api) {
    const repository = new EnrolmentD2Repository(api);

    const getModules = new GetModulesUseCase(repository);
    const getSnapshot = new GetSnapshotUseCase(repository);
    const getAccess = new GetAccessUseCase(repository);
    const getGeometries = new GetGeometriesUseCase(repository);
    const getHistory = new GetHistoryUseCase(repository);
    const validate = new ValidateChangeUseCase(repository);
    const apply = new ApplyChangeUseCase(repository);

    return {
        getModules: () => getModules.execute(),
        getSnapshot: (modules: string[]) => getSnapshot.execute(modules),
        getAccess: (modules: GlassModule[]) => getAccess.execute(modules),
        getGeometries: () => getGeometries.execute(),
        getHistory: () => getHistory.execute(),
        validate: (changes: ChangeSet) => validate.execute(changes),
        apply: (request: ChangeRequest) => apply.execute(request),
    };
}

export type EnrolmentUseCases = ReturnType<typeof getEnrolmentUseCases>;
