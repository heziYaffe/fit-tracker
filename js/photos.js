/* פיט — progress photos in IndexedDB, client-side compression. */
(function (root) {
  'use strict';

  var DB_MAIN = 'hazi-fit-photos-v1';
  var DB_DEMO = 'hazi-fit-photos-demo-v1';
  var STORE = 'photos';
  var MAX_DIM = 1600;
  var QUALITY = 0.72;
  var _db = null;
  var _dbName = null;

  function dbName() {
    return (root.FitStore && root.FitStore.isDemoMode && root.FitStore.isDemoMode()) ? DB_DEMO : DB_MAIN;
  }

  function openDb() {
    const name = dbName();
    if (_db && _dbName === name) return Promise.resolve(_db);
    if (_db) {
      try { _db.close(); } catch (e) {}
      _db = null;
    }
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no-idb'));
    _dbName = name;
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function txStore(mode) {
    return openDb().then(function (db) {
      const tx = db.transaction(STORE, mode || 'readonly');
      return tx.objectStore(STORE);
    });
  }

  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function compressFile(file, opts) {
    opts = opts || {};
    const maxDim = opts.maxDim || MAX_DIM;
    const quality = opts.quality || QUALITY;
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      return Promise.resolve({ blob: file, width: 0, height: 0, mime: file.type || 'image/jpeg' });
    }
    return new Promise(function (resolve, reject) {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        const scale = Math.min(1, maxDim / Math.max(w, h, 1));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error('compress-failed')); return; }
          resolve({ blob: blob, width: w, height: h, mime: 'image/jpeg' });
        }, 'image/jpeg', quality);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('image-load-failed'));
      };
      img.src = url;
    });
  }

  function uid() {
    if (root.FitStore && root.FitStore.uid) return root.FitStore.uid();
    return 'ph_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function addPhoto(meta, file) {
    meta = meta || {};
    return compressFile(file).then(function (out) {
      const row = {
        id: meta.id || uid(),
        date: meta.date || (root.FitEngine && root.FitEngine.todayISO()) || '',
        pose: meta.pose || 'front',
        createdAt: new Date().toISOString(),
        width: out.width,
        height: out.height,
        mime: out.mime,
        size: out.blob.size,
        blob: out.blob
      };
      return txStore('readwrite').then(function (os) {
        return reqToPromise(os.put(row)).then(function () { return row; });
      });
    });
  }

  function listPhotos() {
    return txStore('readonly').then(function (os) {
      return reqToPromise(os.getAll());
    }).then(function (rows) {
      rows = rows || [];
      rows.sort(function (a, b) {
        if (a.date === b.date) return (b.createdAt || '').localeCompare(a.createdAt || '');
        return a.date < b.date ? 1 : -1;
      });
      return rows;
    }).catch(function () { return []; });
  }

  function getPhoto(id) {
    return txStore('readonly').then(function (os) { return reqToPromise(os.get(id)); });
  }

  function deletePhoto(id) {
    return txStore('readwrite').then(function (os) { return reqToPromise(os.delete(id)); });
  }

  function clearAll() {
    return openDb().then(function (db) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      return new Promise(function (resolve, reject) {
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    }).catch(function () {});
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    const header = parts[0] || '';
    const mime = (header.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(parts[1] || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function exportPhotos() {
    return listPhotos().then(function (rows) {
      return Promise.all(rows.map(function (row) {
        if (!row.blob) return null;
        return blobToDataUrl(row.blob).then(function (dataUrl) {
          return {
            id: row.id,
            date: row.date,
            pose: row.pose,
            createdAt: row.createdAt,
            width: row.width,
            height: row.height,
            mime: row.mime,
            dataUrl: dataUrl
          };
        });
      })).then(function (list) { return list.filter(Boolean); });
    });
  }

  function importPhotos(list) {
    if (!list || !list.length) return Promise.resolve(0);
    return txStore('readwrite').then(function (os) {
      let n = 0;
      const puts = list.map(function (row) {
        if (!row || !row.dataUrl) return Promise.resolve();
        const rec = {
          id: row.id || uid(),
          date: row.date,
          pose: row.pose || 'front',
          createdAt: row.createdAt || new Date().toISOString(),
          width: row.width || 0,
          height: row.height || 0,
          mime: row.mime || 'image/jpeg',
          blob: dataUrlToBlob(row.dataUrl)
        };
        rec.size = rec.blob.size;
        n += 1;
        return reqToPromise(os.put(rec));
      });
      return Promise.all(puts).then(function () { return n; });
    });
  }

  function objectUrl(row) {
    if (!row || !row.blob) return '';
    return URL.createObjectURL(row.blob);
  }

  function measureFields() {
    return [
      { key: 'waist', label: 'מותן' },
      { key: 'chest', label: 'חזה' },
      { key: 'arm', label: 'זרוע' },
      { key: 'thigh', label: 'ירך' },
      { key: 'hips', label: 'ירכיים' }
    ];
  }

  function normalizeMeasure(m) {
    m = m || {};
    const row = {
      id: m.id || uid(),
      date: m.date || '',
      notes: m.notes || ''
    };
    measureFields().forEach(function (f) {
      const v = m[f.key];
      row[f.key] = v === '' || v == null ? '' : Number(v);
    });
    return row;
  }

  var FitPhotos = {
    dbName: dbName,
    compressFile: compressFile,
    addPhoto: addPhoto,
    listPhotos: listPhotos,
    getPhoto: getPhoto,
    deletePhoto: deletePhoto,
    clearAll: clearAll,
    exportPhotos: exportPhotos,
    importPhotos: importPhotos,
    objectUrl: objectUrl,
    measureFields: measureFields,
    normalizeMeasure: normalizeMeasure,
    close: function () {
      if (_db) { try { _db.close(); } catch (e) {} _db = null; _dbName = null; }
    }
  };

  root.FitPhotos = FitPhotos;
  if (typeof module !== 'undefined' && module.exports) module.exports = FitPhotos;
})(typeof window !== 'undefined' ? window : globalThis);
