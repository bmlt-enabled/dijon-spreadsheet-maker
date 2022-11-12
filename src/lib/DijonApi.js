import {
  Configuration,
  DefaultApi,
} from 'dijon-client';
  
  class ApiClient extends DefaultApi {
    constructor(token) {
      super();
      this._authorizationHeader = null;
      this._token = null;
      this.token = token;
      const dijonBaseUrl = 'https://dijon-api.bmlt.dev';
      // const dijonBaseUrl = 'http://localhost:8000';
      this.configuration = new Configuration({
        basePath: dijonBaseUrl,
        accessToken: () => this._authorizationHeader ?? '',
      });
    }
  
    set token(token) {
      this._token = token ?? null;
      this.accessToken = token?.accessToken ?? null;
    }
  
    get token() {
      return this._token;
    }
  
    set accessToken(accessToken) {
      if (!accessToken) {
        this._authorizationHeader = '';
      } else {
        this._authorizationHeader = `Bearer ${accessToken}`;
      }
    }
  
    get isLoggedIn() {
      return !!this._authorizationHeader;
    }
  }
  
  class ApiClientWrapper {
    static instance = new ApiClientWrapper();
  
    constructor(token) {
      if (!token) {
        const tokenJson = localStorage.getItem('token');
        if (tokenJson) {
          token = JSON.parse(tokenJson);
        }
      }
  
      this.api = new ApiClient(token);
    }
  
    set token(token) {
      if (token) {
        localStorage.setItem('token', JSON.stringify(token));
      } else {
        localStorage.removeItem('token');
      }
  
      this.api.token = token;
    }
  
    get token() {
      return this.api.token;
    }
  
    get isLoggedIn() {
      return this.api.isLoggedIn;
    }

    async createToken(username, password) {
      return this.api.createAuthTokenTokenPost({ grantType: 'password', username, password });
    }

    async listRootServers() {
      return this.api.listRootServersRootserversGet();
    }

    async listRootServerSnapshots(rootServerId) {
      return this.api.listServerSnapshotsRootserversRootServerIdSnapshotsGet({ rootServerId });
    }

    async listServerMeetingNawsCodes(rootServerId) {
      return this.api.listServerMeetingNawsCodesRootserversRootServerIdMeetingsNawscodesGet({ rootServerId });
    }

    async listSnapshotServiceBodies(rootServerId, date) {
        return this.api.listSnapshotServiceBodiesRootserversRootServerIdSnapshotsDateServicebodiesGet({ rootServerId, date});
    }

    async listSnapshotMeetings(rootServerId, date, serviceBodyBmltIds) {
      return this.api.listSnapshotMeetingsRootserversRootServerIdSnapshotsDateMeetingsGet({ rootServerId, date, serviceBodyBmltIds });
    }

    async listMeetingChanges(rootServerId, startDate, endDate, serviceBodyBmltIds, excludeWorldIdUpdates) {
      return this.api.listMeetingChangesRootserversRootServerIdMeetingsChangesGet({ rootServerId, startDate, endDate, serviceBodyBmltIds, excludeWorldIdUpdates });
    }

    async batchUpdateMeetingNawsCodes(rootServerId, nawsCodes) {
      return this.api.batchUpdateMeetingNawsCodesRootserversRootServerIdMeetingsNawscodesPatch({ rootServerId, nawsCodeCreate: nawsCodes });
    }
  }
  
  export default ApiClientWrapper.instance;
  