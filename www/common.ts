/// <reference types="cordova-plugin-file" />
/// <reference types="cordova" />

declare const cordova: Cordova;
declare const resolveLocalFileSystemURL: Window['resolveLocalFileSystemURL'] ;
declare const IonicWebView: any;

import {
  CallbackFunction,
  CheckDeviceResponse,
  FetchManifestResp,
  IAppInfo,
  IDeployConfig,
  IDeployPluginAPI,
  IPluginBaseAPI,
  ISavedPreferences,
  ISnapshotInfo,
  IStorePreferences,
  ISyncOptions,
  ManifestFileEntry,
} from './definitions';

import {
  isPluginConfig
} from './guards';

// NATIVE API TODO:
// getPreferences
// syncPreferences


class Path {
    join(...paths: string[]): string {
        let fullPath: string = paths.shift() || '';
        for (const path of paths) {
            if (fullPath && fullPath.slice(-1) !== '/') {
                fullPath += '/';
            }
            fullPath = path.slice(0, 1) !== '/' ? fullPath + path : fullPath + path.slice(1);
        }
        return fullPath;
    }

}
const path = new Path();

/**
 * LIVE UPDATE API
 *
 * The plugin API for the live updates feature.
 */

class IonicDeploy implements IDeployPluginAPI {

  private _savedPreferences: Promise<ISavedPreferences>;
  private _parent: IPluginBaseAPI;
  private _PREFS_KEY = '_ionicDeploySavedPrefs';
  private _fileManager: FileManager = new FileManager();
  public FILE_CACHE = 'ionic_snapshot_files';
  public MANIFEST_CACHE = 'ionic_manifests';
  public SNAPSHOT_CACHE = 'ionic_built_snapshots';
  public PLUGIN_VERSION = '5.0.0';
  public NO_VERSION_DEPLOYED = 'none';
  public UNKNOWN_BINARY_VERSION = 'unknown';

  // Update method constants
  public UPDATE_AUTO = 'auto';
  public UPDATE_BACKGROUND = 'background';
  public UPDATE_NONE = 'none';

  constructor(parent: IPluginBaseAPI) {
    this._parent = parent;
    this._savedPreferences = this._initPreferences();
    this._savedPreferences.then(this._handleInitialPreferenceState.bind(this));
  }

  _handleInitialPreferenceState(prefs: ISavedPreferences) {
    this.sync({updateMethod: prefs.updateMethod});
  }

  _initPreferences(): Promise<ISavedPreferences> {
    return new Promise((resolve, reject) => {
      try {
        const prefsString = localStorage.getItem(this._PREFS_KEY);
        if (!prefsString) {
          //cordova.exec(prefs => {
          //  resolve(prefs);
          //  this._syncPrefs();
          //}, reject, 'IonicCordovaCommon', 'getPreferences');
          resolve({
            appId: '4e6b62ff',
            debug: 'false',
            channel: 'Master',
            host: 'https://api-staging.ionicjs.com',
            updateMethod: 'none',
            maxVersions: 5,
            currentVersionId: '2622e7d7-9d39-496c-ad95-87f76b31f10f'
          });
          return;
        }
        const savedPreferences = JSON.parse(prefsString);
        resolve(savedPreferences);
      } catch (e) {
        reject(e.message);
      }
    });
  }

  getFileCacheDir(): string {
    return path.join(cordova.file.cacheDirectory, this.FILE_CACHE);
  }

  getManifestCacheDir(): string {
    return path.join(cordova.file.dataDirectory, this.MANIFEST_CACHE);
  }

  getSnapshotCacheDir(versionId: string): string {
    return path.join(cordova.file.dataDirectory, this.SNAPSHOT_CACHE, versionId);
  }

  private async _syncPrefs(prefs: IStorePreferences = {}) {
    const appInfo = await this._parent.getAppDetails();
    const currentPrefs = await this._savedPreferences;

    if (currentPrefs) {
      currentPrefs.binaryVersion = appInfo.bundleVersion;
      Object.assign(currentPrefs, prefs);
    }
    localStorage.setItem(this._PREFS_KEY, JSON.stringify(currentPrefs));
    return currentPrefs;
  }

  init(config: IDeployConfig, success: CallbackFunction<void>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.configure.');
    this.configure(config).then(
      result => success(),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async configure(config: IDeployConfig) {
    if (!isPluginConfig(config)) {
      throw new Error('Invalid Config Object');
    }
    // TODO: make sure the user can't overwrite protected things
    Object.assign(await this._savedPreferences, config);
    return new Promise( (resolve, reject) => {
      this._syncPrefs();
    });
  }

  check(success: CallbackFunction<string>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.checkForUpdate.');
    this.checkForUpdate().then(
      result => success(String(result.available)),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async checkForUpdate(): Promise<CheckDeviceResponse> {
    const savedPreferences = await this._savedPreferences;
    const appInfo = await this._parent.getAppDetails();
    const endpoint = `${savedPreferences.host}/apps/${savedPreferences.appId}/channels/check-device`;
    const device_details = {
      binary_version: appInfo.bundleVersion,
      platform: appInfo.platform,
      snapshot: savedPreferences.currentVersionId
    };
    const body = {
      channel_name: savedPreferences.channel,
      app_id: savedPreferences.appId,
      device: device_details,
      plugin_version: this.PLUGIN_VERSION,
      manifest: true
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(body)
    });

    let jsonResp;
    if (resp.status < 500) {
      jsonResp = await resp.json();
    }
    if (resp.ok) {
      const checkDeviceResp: CheckDeviceResponse = jsonResp.data;
      console.log('CHECK RESP', checkDeviceResp);
      if (checkDeviceResp.available && checkDeviceResp.url) {
        savedPreferences.availableUpdate = checkDeviceResp;
        await this._syncPrefs();
      }
      return checkDeviceResp;
    }

    throw new Error(`Error Status ${resp.status}: ${jsonResp ? jsonResp.error.message : await resp.text()}`);
  }

  download(success: CallbackFunction<string>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.downloadUpdate.');
    this.downloadUpdate().then(
      result => success(result),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async downloadUpdate(): Promise<string> {
    const prefs = await this._savedPreferences;
    if (prefs.availableUpdate && prefs.availableUpdate.available && prefs.availableUpdate.url && prefs.availableUpdate.snapshot) {
      const { manifestBlob, fileBaseUrl } = await this._fetchManifest(prefs.availableUpdate.url);
      const manifestString = await this._fileManager.getFile(
        this.getManifestCacheDir(),
        this._getManifestName(prefs.availableUpdate.snapshot),
        true,
        manifestBlob
      );
      const manifestJson = JSON.parse(manifestString);
      await this._downloadFilesFromManifest(fileBaseUrl, manifestJson);
      prefs.pendingUpdate = prefs.availableUpdate.snapshot;
      delete prefs.availableUpdate;
      await this._syncPrefs();
      return 'true';
    }
    throw new Error('No available updates');
  }

  private _getManifestName(versionId: string) {
    return versionId + '-manifest.json';
  }

  private async _downloadFilesFromManifest(baseUrl: string, manifest: ManifestFileEntry[]) {
    return Promise.all(manifest.map( async file => {
      const alreadyExists = await this._fileManager.fileExists(
        this.getFileCacheDir(),
        this._cleanHash(file.integrity)
      );
      if (alreadyExists) {
        console.log(`file ${file.href} with size ${file.size} already exists`);
        return;
      } else {
        console.log(`file ${file.href} with size ${file.size} didn't exist`);
      }

      // if it's 0 size file just create it
      if (file.size === 0) {
        return this._fileManager.getFile(
          this.getFileCacheDir(),
          this._cleanHash(file.integrity),
          true,
          new Blob()
        );
      }

      // otherwise get it from internets
      const base = new URL(baseUrl);
      const newUrl = new URL(file.href, baseUrl);
      newUrl.search = base.search;
      return fetch( newUrl.toString(), {
        method: 'GET',
        integrity: file.integrity,
      }).then( async (resp: Response) => {
        return this._fileManager.getFile(
          this.getFileCacheDir(),
          this._cleanHash(file.integrity),
          true,
          await resp.blob()
        );
      });
    }));
  }

  private _cleanHash(metadata: string): string {
    const hashes = metadata.split(' ');
    return hashes[0].replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private async _fetchManifest(url: string): Promise<FetchManifestResp> {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
    });
    return {
      manifestBlob: await resp.blob(),
      fileBaseUrl: resp.url
    };
  }

  extract(success: CallbackFunction<string>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.extractUpdate.');
    this.extractUpdate().then(
      result => success(result),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async extractUpdate(): Promise<string> {
    const prefs = await this._savedPreferences;
    if (!prefs.pendingUpdate) {
      throw new Error('No pending update to extract');
    }
    const versionId = prefs.pendingUpdate;
    const manifestString = await this._fileManager.getFile(
      this.getManifestCacheDir(),
      this._getManifestName(versionId)
    );
    const manifest = JSON.parse(manifestString);
    const snapshotDir = this.getSnapshotCacheDir(versionId);
    try {
      const dirEntry = await this._fileManager.getDirectory(snapshotDir, false);
      console.log(`directory found for snapshot ${versionId} deleting`);
      await (new Promise( (resolve, reject) => dirEntry.removeRecursively(resolve, reject)));
    } catch (e) {
      console.log('No directory found for snapshot no need to delete');
    }

    await this._copyBaseAppDir(versionId);
    console.log('Successful Swizzle');
    await Promise.all(manifest.map( async (file: ManifestFileEntry) => {
      const splitPath = file.href.split('/');
      const fileName = splitPath.pop();
      let path;
      if (splitPath.length > 0) {
        path = splitPath.join('/');
      }
      path =  snapshotDir + (path ? ('/' + path) : '');
      if (fileName) {
        try {
          await this._fileManager.removeFile(path, fileName);
          console.log(`removed old file at ${path}/${fileName}`);
        } catch (e) {
          console.log(`brand new file ${path}/${fileName}`);
        }

        return this._fileManager.copyTo(
          this.getFileCacheDir(),
          this._cleanHash(file.integrity),
          path,
          fileName
        );
      }
      throw new Error('No file name found');
    }));
    console.log('Successful recreate');
    prefs.updateReady = prefs.pendingUpdate;
    delete prefs.pendingUpdate;
    await this._syncPrefs();
    return 'true';
  }

  redirect(success: CallbackFunction<string>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.reloadApp.');
    this.reloadApp().then(
      result => success(result),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async reloadApp(): Promise<string> {
    const prefs = await this._savedPreferences;
    if (prefs.updateReady) {
      prefs.currentVersionId = prefs.updateReady;
      delete prefs.updateReady;
      await this._syncPrefs();
    }
    if (prefs.currentVersionId) {
      const snapshotDir = this.getSnapshotCacheDir(prefs.currentVersionId);
      if (cordova.platformId !== 'ios') {
        const newLocation = new URL(`${snapshotDir}/index.html`);
        console.log(`Redirecting window to ${newLocation}`);
        window.location.pathname = newLocation.pathname;
      } else {
        const newLocation = new URL(snapshotDir);
        console.log('setting new server root');
        console.log(newLocation.pathname);
        IonicWebView.setWebRoot(newLocation.pathname);
        window.location.reload();
      }
      return 'true';
    } else {
      window.location.reload();
      return 'true';
    }
  }

  private async _copyBaseAppDir(versionId: string) {
    return new Promise( async (resolve, reject) => {
      try {
        const rootAppDirEntry = await this._fileManager.getDirectory(`${cordova.file.applicationDirectory}/www`, false);
        const snapshotCacheDirEntry = await this._fileManager.getDirectory(this.getSnapshotCacheDir(''), true);
        rootAppDirEntry.copyTo(snapshotCacheDirEntry, versionId, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  info(success: CallbackFunction<ISnapshotInfo>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.getCurrentVersion.');
    this.getCurrentVersion().then(
      result => success(result),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async getCurrentVersion(): Promise<ISnapshotInfo> {
    const versionId = (await this._savedPreferences).currentVersionId;
    if (typeof versionId === 'string') {
      return this.getVersionById(versionId);
    }
    throw new Error('No current version applied.');
  }

  async getVersionById(versionId: string): Promise<ISnapshotInfo> {
    // TODO: Implement
    // cordova.exec(success, failure, 'IonicDeploy', 'info');
    return {
      deploy_uuid: 'TODO',
      versionId: 'TODO',
      channel: 'todo',
      binary_version: 'todo',
      binaryVersion: 'todo'
    };
  }

  getVersions(success: CallbackFunction<string[]>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.getAvailableVersions.');
    this.getAvailableVersions().then(
      results => success(results.map(result => result.versionId)),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async getAvailableVersions(): Promise<ISnapshotInfo[]> {
    // TODO: Implement
    // cordova.exec(success, failure, 'IonicDeploy', 'getVersions');
    return [{
      deploy_uuid: 'TODO',
      versionId: 'TODO',
      channel: 'todo',
      binary_version: 'todo',
      binaryVersion: 'todo'
    }];
  }

  deleteVersion(versionId: string, success: CallbackFunction<string>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.delpoy.deleteVersionById.');
    this.deleteVersionById(versionId).then(
      result => success(result),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async deleteVersionById(versionId: string): Promise<string> {
    // TODO: Implement
    // cordova.exec(success, failure, 'IonicDeploy', 'deleteVersion', [version]);
    return 'Implement me please';
  }

  async sync(syncOptions: ISyncOptions = {updateMethod: 'background'}): Promise<ISnapshotInfo> {
    await this.checkForUpdate();

    // TODO: Get API override if present
    const prefs = await this._syncPrefs();
    const updateMethod =  syncOptions.updateMethod || prefs.updateMethod;

    if (updateMethod !== this.UPDATE_NONE && prefs.availableUpdate && prefs.availableUpdate.available) {
      await this.downloadUpdate();
      await this.extractUpdate();

      if (updateMethod === this.UPDATE_AUTO) {
        await this.reloadApp();
      }
    }

    return {
      deploy_uuid: prefs.currentVersionId || this.NO_VERSION_DEPLOYED,
      versionId: prefs.currentVersionId || this.NO_VERSION_DEPLOYED,
      channel: prefs.channel,
      binary_version: prefs.binaryVersion || this.UNKNOWN_BINARY_VERSION,
      binaryVersion: prefs.binaryVersion || this.UNKNOWN_BINARY_VERSION
    };
  }
}

class FileManager {

  async getDirectory(path: string, createDirectory = true): Promise<DirectoryEntry> {
    return new Promise<DirectoryEntry>((resolve, reject) => {
      resolveLocalFileSystemURL(
        path,
        entry => entry.isDirectory ? resolve(entry as DirectoryEntry) : reject(),
        async () => {
          const components = path.split('/');
          const child = components.pop() as string;
          try {
            const parent = (await this.getDirectory(components.join('/'), createDirectory)) as DirectoryEntry;
            parent.getDirectory(child, { create: createDirectory }, resolve, reject);
          } catch (e) {
            reject(e);
          }
        }
      );
    });
  }

  async resolvePath(): Promise<DirectoryEntry> {
    return new Promise<DirectoryEntry>( (resolve, reject) => {
      resolveLocalFileSystemURL(cordova.file.dataDirectory, (rootDirEntry: Entry) => {
        resolve(rootDirEntry as DirectoryEntry);
      }, reject);
    });
  }

  async readFile(fileEntry: FileEntry): Promise<string> {

    return new Promise<string>( (resolve, reject) => {
      fileEntry.file( (file) => {
        const reader = new FileReader();

        reader.onloadend = () => {
          resolve(reader.result as string);
        };

        reader.readAsText(file);

      }, reject);
    });
  }

  async getFile(path: string, fileName: string, createFile = false, dataBlob?: Blob): Promise<string> {
    const fileEntry = await this.getFileEntry(path, fileName, createFile, dataBlob);
    return this.readFile(fileEntry);
  }

  async getFileEntry(path: string, fileName: string, createFile = false, dataBlob?: Blob) {
    if (createFile && !dataBlob) {
      throw new Error('Must provide file blob if createFile is true');
    }
    const dirEntry = await this.getDirectory(path, createFile);
    return new Promise<FileEntry>( (resolve, reject) => {
      dirEntry.getFile(fileName, {create: createFile, exclusive: false}, async (fileEntry: FileEntry) => {
        if (dataBlob) {
          await this.writeFile(fileEntry, dataBlob);
        }
        resolve(fileEntry);
      }, reject);
    });
  }

  async fileExists(path: string, fileName: string) {
    try {
      await this.getFileEntry(path, fileName);
      return true;
    } catch (e) {
      return false;
    }
  }

  async copyTo(oldPath: string, oldFileName: string, newPath: string, newFileName: string) {
    const fileEntry = await this.getFileEntry(oldPath, oldFileName);
    const newDirEntry = await this.getDirectory(newPath);
    return new Promise( (resolve, reject) => {
      fileEntry.copyTo(newDirEntry, newFileName, resolve, reject);
    });
  }

  async removeFile(path: string, filename: string) {
    const fileEntry = await this.getFileEntry(path, filename);
    return new Promise( (resolve, reject) => {
      fileEntry.remove(resolve, reject);
    });
  }

  async writeFile(fileEntry: FileEntry, dataBlob: Blob) {
    return new Promise( (resolve, reject) => {
      fileEntry.createWriter( (fileWriter: FileWriter) => {

        const status = {done: 0};
        let chunks = 1;
        let offset = Math.floor(dataBlob.size/chunks);

        // Maxumum chunk size 1MB
        while (offset > (1024 * 1000)) {
          chunks *= 2;
          offset = Math.floor(dataBlob.size/chunks);
        }

        fileWriter.onwriteend = (file) => {
          status.done += 1;
          if (status.done > 100) {
            resolve();
          } else {
            fileWriter.seek(fileWriter.length);
            fileWriter.write(dataBlob.slice(status.done * offset, (status.done * offset) + offset));
          }
        };

        fileWriter.onerror = (e: ProgressEvent) => {
          reject(e.toString());
        };

        fileWriter.write(dataBlob.slice(0, offset));
      });
    });
  }

}

/**
 * BASE API
 *
 * All features of the Ionic Cordova plugin are registered here, along with some low level error tracking features used
 * by the monitoring service.
 */
class IonicCordova implements IPluginBaseAPI {

  public deploy: IDeployPluginAPI;

  constructor() {
    this.deploy = new IonicDeploy(this);
  }

  getAppInfo(success: CallbackFunction<IAppInfo>, failure: CallbackFunction<string>) {
    console.warn('This function has been deprecated in favor of IonicCordova.getAppDetails.');
    this.getAppDetails().then(
      result => success(result),
      err => {
        typeof err === 'string' ? failure(err) : failure(err.message);
      }
    );
  }

  async getAppDetails(): Promise<IAppInfo> {
    return new Promise<IAppInfo>( (resolve, reject) => {
      cordova.exec(resolve, reject, 'IonicCordovaCommon', 'getAppInfo');
    });
  }
}

const instance = new IonicCordova();
export = instance;
