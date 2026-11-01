import Oas from 'oas';
import APICore from 'api/dist/core';
import definition from './openapi.json';
class SDK {
    constructor() {
        this.spec = Oas.init(definition);
        this.core = new APICore(this.spec, 'csgoempire/unknown (api/6.1.3)');
    }
    /**
     * Optionally configure various options that the SDK allows.
     *
     * @param config Object of supported SDK options and toggles.
     * @param config.timeout Override the default `fetch` request timeout of 30 seconds. This number
     * should be represented in milliseconds.
     */
    config(config) {
        this.core.setConfig(config);
    }
    /**
     * If the API you're using requires authentication you can supply the required credentials
     * through this method and the library will magically determine how they should be used
     * within your API request.
     *
     * With the exception of OpenID and MutualTLS, it supports all forms of authentication
     * supported by the OpenAPI specification.
     *
     * @example <caption>HTTP Basic auth</caption>
     * sdk.auth('username', 'password');
     *
     * @example <caption>Bearer tokens (HTTP or OAuth 2)</caption>
     * sdk.auth('myBearerToken');
     *
     * @example <caption>API Keys</caption>
     * sdk.auth('myApiKey');
     *
     * @see {@link https://spec.openapis.org/oas/v3.0.3#fixed-fields-22}
     * @see {@link https://spec.openapis.org/oas/v3.1.0#fixed-fields-22}
     * @param values Your auth credentials for the API; can specify up to two strings or numbers.
     */
    auth(...values) {
        this.core.setAuth(...values);
        return this;
    }
    /**
     * If the API you're using offers alternate server URLs, and server variables, you can tell
     * the SDK which one to use with this method. To use it you can supply either one of the
     * server URLs that are contained within the OpenAPI definition (along with any server
     * variables), or you can pass it a fully qualified URL to use (that may or may not exist
     * within the OpenAPI definition).
     *
     * @example <caption>Server URL with server variables</caption>
     * sdk.server('https://{region}.api.example.com/{basePath}', {
     *   name: 'eu',
     *   basePath: 'v14',
     * });
     *
     * @example <caption>Fully qualified server URL</caption>
     * sdk.server('https://eu.api.example.com/v14');
     *
     * @param url Server URL
     * @param variables An object of variables to replace into the server URL.
     */
    server(url, variables = {}) {
        this.core.setServer(url, variables);
    }
    /**
     * Returns the user object, which is used to identify via websocket, as well as socket
     * token (authorizationToken) & socket signature (signature) which are used to authenticate
     * on the websocket.
     *
     * @summary Metadata
     * @throws FetchError<400, types.MetadataResponse400> 400
     * @throws FetchError<429, types.MetadataResponse429> 429
     */
    metadata() {
        return this.core.fetch('/metadata/socket', 'get');
    }
    /**
     * Returns an array of all items currently being deposited or withdrawn by this account.
     * This does not include bids placed on active items until the auction ends.
     *
     * @summary Get Active Trades
     * @throws FetchError<400, types.GetActiveTradesResponse400> 400
     * @throws FetchError<429, types.GetActiveTradesResponse429> 429
     */
    getActiveTrades() {
        return this.core.fetch('/trading/user/trades', 'get');
    }
    /**
     * Returns an array of all auctions currently being bid on by this account.
     *
     * @summary Get Active Auctions
     * @throws FetchError<400, types.GetActiveAuctionsResponse400> 400
     * @throws FetchError<429, types.GetActiveAuctionsResponse429> 429
     */
    getActiveAuctions() {
        return this.core.fetch('/trading/user/auctions', 'get');
    }
    /**
     * Used to update your trade URL or the marketplace privacy protection level.
     *
     * @summary Settings
     * @throws FetchError<400, types.SettingsResponse400> 400
     * @throws FetchError<429, types.SettingsResponse429> 429
     */
    settings(body) {
        return this.core.fetch('/trading/user/settings', 'post', body);
    }
    /**
     * Used to get your transaction history.
     *
     * @summary Transaction History
     * @throws FetchError<400, types.TransactionHistoryResponse400> 400
     * @throws FetchError<429, types.TransactionHistoryResponse429> 429
     */
    transactionHistory(metadata) {
        return this.core.fetch('/user/transactions', 'get', metadata);
    }
    /**
     * Used to tip other accounts using their Steam/Empire ID. This requires 2FA codes
     * alongside your API key in order to work.
     *
     * @summary Tipping
     * @throws FetchError<400, types.TippingResponse400> 400
     * @throws FetchError<429, types.TippingResponse429> 429
     */
    tipping(body) {
        return this.core.fetch('/user/tip', 'post', body);
    }
}
const createSDK = (() => { return new SDK(); })();
export default createSDK;
