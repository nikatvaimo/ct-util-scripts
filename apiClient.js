import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';
import { ClientBuilder } from '@commercetools/sdk-client-v2';
import dotenv from 'dotenv';

let ctClientCache;

dotenv.config();

export const buildApiClient = () => {
    if (ctClientCache) {
        return ctClientCache;
    }
    const projectKey = process.env['CTP_PROJECT_KEY'];
    const clientId = process.env['CTP_CLIENT_ID'];
    const clientSecret = process.env['CTP_CLIENT_SECRET'];
    const apiUrl = process.env['CTP_API_URL'];
    const authUrl = process.env['CTP_AUTH_URL'];
    const scopes = process.env['CTP_SCOPES'] ? process.env['CTP_SCOPES'].split(' ') : []  ;

    if (!projectKey || !clientId || !clientSecret || !apiUrl || !authUrl || !scopes) {
        throw new Error('Client configuration is not provided. Please add the commercetools api client configuration.');
    }

    const authMiddlewareOptions = {
        host: authUrl,
        projectKey,
        credentials: {
            clientId: clientId,
            clientSecret: clientSecret,
        },
        scopes: scopes,
    };

    const httpMiddlewareOptions = {
        host: apiUrl,
        enableRetry: true,
        retryConfig: {
            maxRetries: 3,
            retryDelay: 200,
            backoff: true,
            retryCodes: [500, 502, 503, 504],
        },
    };

    const ctpClient = new ClientBuilder()
        .withClientCredentialsFlow(authMiddlewareOptions)
        .withHttpMiddleware(httpMiddlewareOptions)
        .build();

    return (ctClientCache = createApiBuilderFromCtpClient(ctpClient).withProjectKey({ projectKey }));
};
