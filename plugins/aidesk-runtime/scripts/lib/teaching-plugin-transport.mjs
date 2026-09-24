// Generated from services/authority-api/src/teaching-plugin-transport.ts; source SHA-256 81c6c39d3b6eb6d425751b00fd04c509a1cdccef45f76a4a700bd12e8f45d31c.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { parseTeachingBusinessInput, teachingObject, TeachingInputError } from "./teaching-business-contract.mjs";
import { goalTextResultFromPublic, parseGoalBusinessInput } from "./teaching-goal-contract.mjs";
/** Lossless transport projection only. The durable outbox and original RPC
 * continue to use the full 03 request. The signature covers both this fragment
 * and the hash of the public model arguments, so duplicated large text need
 * not occupy the shared 32 KiB HTTP envelope twice.
 */
export function packTeachingPluginRequest(action, input) {
    const request = structuredClone(input);
    if (action === "start")
        delete request.taskAction;
    else if (action === "commit") {
        delete request.payload;
        const expected = request.expected;
        delete expected.dependencies;
    }
    else
        return request;
    return { format: "model-fields-v1", request };
}
export function unpackTeachingPluginRequest(action, wire, args) {
    if (!teachingObject(wire) || !Object.hasOwn(wire, "format"))
        return parseTeachingBusinessInput(action, wire);
    if (Object.keys(wire).length !== 2 || wire.format !== "model-fields-v1" || !teachingObject(wire.request)
        || (action !== "start" && action !== "commit"))
        throw new TeachingInputError();
    const request = structuredClone(wire.request);
    if (action === "start") {
        if (Object.hasOwn(request, "taskAction"))
            throw new TeachingInputError();
        request.taskAction = structuredClone(args.taskAction);
    }
    else {
        if (Object.hasOwn(request, "payload") || !teachingObject(request.expected) || Object.hasOwn(request.expected, "dependencies"))
            throw new TeachingInputError();
        const payload = structuredClone(args);
        delete payload._aidesk;
        delete payload.dependencies;
        delete payload.taskRef;
        delete payload.expectedSequence;
        request.payload = payload;
        request.expected.dependencies = structuredClone(args.dependencies);
    }
    return parseTeachingBusinessInput(action, request);
}
/** Explicit v2 projection. The discriminator is public transport metadata,
 * never part of a goal/checkpoint payload; unknown contracts never fall back. */
export function packGoalPluginRequest(action, input) {
    const request = structuredClone(input);
    if (action === "start")
        delete request.taskAction;
    else if (action === "commit") {
        delete request.payload;
        delete request.expected.dependencies;
    }
    else
        return request;
    return { format: "model-fields-v1", request };
}
export function unpackGoalPluginRequest(action, wire, args) {
    if (!teachingObject(wire) || !Object.hasOwn(wire, "format"))
        return parseGoalBusinessInput(action, wire);
    if (Object.keys(wire).length !== 2 || wire.format !== "model-fields-v1" || !teachingObject(wire.request)
        || (action !== "start" && action !== "commit"))
        throw new TeachingInputError();
    const request = structuredClone(wire.request);
    if (action === "start") {
        if (Object.hasOwn(request, "taskAction"))
            throw new TeachingInputError();
        request.taskAction = structuredClone(args.taskAction);
    }
    else {
        if (Object.hasOwn(request, "payload") || !teachingObject(request.expected) || Object.hasOwn(request.expected, "dependencies"))
            throw new TeachingInputError();
        const payload = structuredClone(args);
        for (const key of ["_aidesk", "contract", "dependencies", "taskRef", "expectedSequence"])
            delete payload[key];
        if (request.action === "checkpoint" && Object.hasOwn(payload, "textResult"))
            payload.textResult = goalTextResultFromPublic(payload.textResult);
        request.payload = payload;
        request.expected.dependencies = structuredClone(args.dependencies);
    }
    return parseGoalBusinessInput(action, request);
}
