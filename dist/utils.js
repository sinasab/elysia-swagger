import { Kind } from '@sinclair/typebox';
import deepClone from 'lodash.clonedeep';
export const toOpenAPIPath = (path) => path
    .split('/')
    .map((x) => (x.startsWith(':') ? `{${x.slice(1, x.length)}}` : x))
    .join('/');
export const mapProperties = (name, schema, models) => {
    if (schema === undefined)
        return [];
    if (typeof schema === 'string')
        if (schema in models)
            schema = models[schema];
        else
            throw new Error(`Can't find model ${schema}`);
    return Object.entries(schema?.properties ?? []).map(([key, value]) => {
        const { type: valueType = undefined, ...rest } = value;
        return {
            // @ts-ignore
            ...rest,
            schema: { type: valueType },
            in: name,
            name: key,
            // @ts-ignore
            required: schema.required?.includes(key) ?? false,
        };
    });
};
const mapTypesResponse = (types, schema) => {
    if (typeof schema === 'object'
        && ['void', 'undefined', 'null'].includes(schema.type))
        return;
    const responses = {};
    for (const type of types)
        responses[type] = {
            schema: typeof schema === 'string'
                ? {
                    $ref: `#/components/schemas/${schema}`
                }
                : { ...schema }
        };
    return responses;
};
export const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
export const generateOperationId = (method, paths) => {
    let operationId = method.toLowerCase();
    if (paths === '/')
        return operationId + 'Index';
    for (const path of paths.split('/')) {
        if (path.charCodeAt(0) === 123) {
            operationId += 'By' + capitalize(path.slice(1, -1));
        }
        else {
            operationId += capitalize(path);
        }
    }
    return operationId;
};
export const registerSchemaPath = ({ schema, path, method, hook, models }) => {
    if (hook)
        hook = deepClone(hook);
    const contentType = hook?.type ?? [
        'application/json',
        'multipart/form-data',
        'text/plain'
    ];
    path = toOpenAPIPath(path);
    const contentTypes = typeof contentType === 'string'
        ? [contentType]
        : contentType ?? ['application/json'];
    const bodySchema = hook?.body;
    const paramsSchema = hook?.params;
    const headerSchema = hook?.headers;
    const querySchema = hook?.query;
    let responseSchema = hook?.response;
    if (typeof responseSchema === 'object') {
        if (Kind in responseSchema) {
            const { type, properties, required, additionalProperties, ...rest } = responseSchema;
            responseSchema = {
                '200': {
                    ...rest,
                    description: rest.description,
                    content: mapTypesResponse(contentTypes, type === 'object' || type === 'array'
                        ? {
                            type,
                            properties,
                            required
                        }
                        : responseSchema)
                }
            };
        }
        else {
            Object.entries(responseSchema).forEach(([key, value]) => {
                if (typeof value === 'string') {
                    if (!models[value])
                        return;
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { type, properties, required, ...rest } = models[value];
                    responseSchema[key] = {
                        ...rest,
                        description: rest.description,
                        content: mapTypesResponse(contentTypes, value)
                    };
                }
                else {
                    const { type, properties, required, additionalProperties, ...rest } = value;
                    responseSchema[key] = {
                        ...rest,
                        description: rest.description,
                        content: mapTypesResponse(contentTypes, {
                            type,
                            properties,
                            required
                        })
                    };
                }
            });
        }
    }
    else if (typeof responseSchema === 'string') {
        if (!(responseSchema in models))
            return;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { type, properties, required, ...rest } = models[responseSchema];
        responseSchema = {
            // @ts-ignore
            '200': {
                ...rest,
                content: mapTypesResponse(contentTypes, responseSchema)
            }
        };
    }
    const parameters = [
        ...mapProperties('header', headerSchema, models),
        ...mapProperties('path', paramsSchema, models),
        ...mapProperties('query', querySchema, models)
    ];
    schema[path] = {
        ...(schema[path] ? schema[path] : {}),
        [method.toLowerCase()]: {
            ...((headerSchema || paramsSchema || querySchema || bodySchema
                ? { parameters }
                : {})),
            ...(responseSchema
                ? {
                    responses: responseSchema
                }
                : {}),
            operationId: hook?.detail?.operationId ?? generateOperationId(method, path),
            ...hook?.detail,
            ...(bodySchema
                ? {
                    requestBody: {
                        content: mapTypesResponse(contentTypes, typeof bodySchema === 'string'
                            ? {
                                $ref: `#/components/schemas/${bodySchema}`
                            }
                            : bodySchema)
                    }
                }
                : null)
        }
    };
};
export const filterPaths = (paths, { excludeStaticFile = true, exclude = [] }) => {
    const newPaths = {};
    for (const [key, value] of Object.entries(paths))
        if (!exclude.some((x) => {
            if (typeof x === 'string')
                return key === x;
            return x.test(key);
        }) &&
            !key.includes('/swagger') &&
            !key.includes('*') &&
            (excludeStaticFile ? !key.includes('.') : true)) {
            Object.keys(value).forEach((method) => {
                const schema = value[method];
                if (key.includes('{')) {
                    if (!schema.parameters)
                        schema.parameters = [];
                    schema.parameters = [
                        ...key
                            .split('/')
                            .filter((x) => x.startsWith('{') &&
                            !schema.parameters.find((params) => params.in === 'path' &&
                                params.name ===
                                    x.slice(1, x.length - 1)))
                            .map((x) => ({
                            in: 'path',
                            name: x.slice(1, x.length - 1),
                            schema: { type: "string" },
                            required: true
                        })),
                        ...schema.parameters
                    ];
                }
                if (!schema.responses)
                    schema.responses = {
                        200: {}
                    };
            });
            newPaths[key] = value;
        }
    return newPaths;
};
