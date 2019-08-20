const {Compiler, Extractor} = require('angular-gettext-tools');
const path = require('path');
const fs = require('fs');
const PO = require('pofile');
const _ = require('lodash');

const {
  OriginalSource,
} = require("webpack-sources");

function matches (oldRef, newRef) {
  return _(oldRef).split(':').first() === _(newRef).split(':').first();
}

function mergeReferences (oldRefs, newRefs) {
  const _newRefs = _(newRefs);

  return _(oldRefs)
      .reject(function (oldRef) {
        return _newRefs.some(function (newRef) {
          return matches(oldRef, newRef);
        });
      })
      .concat(newRefs)
      .uniq()
      .sort()
      .value();
}

function castingAsPoItem(item) {
  return _.reduce(item, (result, value, key) => {
    if (value instanceof PO.Item) {
      return result;
    }
    result[key] = new PO.Item();
    _.assign(result[key], value);
    return result;
  }, item);
}

class AngularGettextPlugin {
  constructor(options) {
    this.options = _.cloneDeep(options);
    this.options.postProcess = this.options.postProcess || function () {};
    this.options.langList = this.options.langList || [];
    this.additioanlStrings = {};
    this.strings = {};
    this.datas = [];
    this.poDatas = null;
  }
  apply(compiler) {
    const compilerOptions = this.options;
    let firstRun = true;

    compilerOptions.preload && compilerOptions.preload();

    const createDummyFiles = (compiler, cb) => {
      if (!firstRun) {
        return cb();
      }
      firstRun = false;
      mkdirSyncRecursive(compilerOptions.baseDir);
      const filePathList = _.flatten(_.map(compilerOptions.langList, locale => {
        return _.map(compilerOptions.resultFiles, metadata => {
          let filename = _.isFunction(metadata.filename) ? metadata.filename(locale) : metadata.filename;
          return path.resolve(compilerOptions.baseDir, filename);
        });
      }));
      Promise.all(_.map(filePathList, filePath => {
        return new Promise((resolve, reject) => {
          if (!fs.existsSync(filePath)) {
            return fs.writeFile(filePath, _.endsWith(filePath, '.json') ? '{}' : '', makePromiseCallback(resolve, reject));
          }
          resolve();
        });
      })).finally(cb);
    };

    compiler.hooks.run.tapAsync('AngularGettextPlugin', createDummyFiles);
    compiler.hooks.watchRun.tapAsync('AngularGettextPlugin', createDummyFiles);

    compiler.hooks.thisCompilation.tap('AngularGettextPlugin', compilation => {
      compilation.hooks.normalModuleLoader.tap('AngularGettextPlugin', loaderContext => {
        loaderContext.emitData = (request, data) => {
          this.datas.push(data);
        };
      });

      compilation.hooks.finishModules.tapAsync('AngularGettextPlugin', (modules, cb) => {
        this.processLoaderDatas();
        if (_.isEmpty(this.additioanlStrings)) {
          return cb();
        }

        if (compilerOptions.potfile) {
          fs.writeFile(compilerOptions.potfile, Extractor.prototype.toPo.call(this, '').toString(), () => {});
        }

        if (this.poDatas) {
          this.appendAdditionalStrings(compilerOptions.langList);
        }
        this.additioanlStrings = {};

        if (compilerOptions.saveCallback) {
          if (!this.poDatas) {
            return compilerOptions.saveCallback(Extractor.prototype.toPo.call(this), null, makeSaveCallbackCb(compilation, cb).bind(this));
          }
          compilerOptions.saveCallback(null, this.poDatas, makeSaveCallbackCb(compilation, cb).bind(this));
        }
      });
    });
  }

  appendAdditionalStrings(langList) {
    _.forEach(langList, lang => {
      const po = this.poDatas[lang];
      for (var msgstr in this.additioanlStrings) {
        var msg = this.additioanlStrings[msgstr];
        var contexts = Object.keys(msg);
        for (var i = 0; i < contexts.length; i++) {
          const value = new PO.Item();
          _.assign(value, msg[contexts[i]]);
          value.msgstr = [''];
          po.items.push(value);
        }
      }
    });
  }

  processLoaderDatas() {
    const NO_CONTEXT = '$$noContext';
    if (this.datas.length > 0) {
      _.forEach(this.datas, data => {
        _.forEach(data, (value, key) => {
          value = castingAsPoItem(value);
          let existing = this.strings[key];
          if (!existing) {
            this.additioanlStrings[key] = value;
            this.strings[key] = value;
            return;
          }

          const item = value[NO_CONTEXT];
          existing = existing[NO_CONTEXT];
          if (item && existing) {
            existing.comments = _.uniq(existing.comments.concat(item.comments)).sort();
            existing.references = mergeReferences(item.references, existing.references);
            return;
          }
          this.strings[key] = _.assign(this.strings[key], value)
          this.additioanlStrings[key] = _.assign(this.additioanlStrings[key], value);
        });
      });
      this.datas.length = 0;
    }
  }
}

function makeSaveCallbackCb(compilation, cb) {
  return function (langList, poDatas, {baseDir, resultFiles} = {}) {
    if (!poDatas) {
      return cb();
    }
    this.poDatas = poDatas;
    const promiseList = _.map(langList, locale => {
      const localeList = [{
        locale,
        strings: Compiler.parsePoItems(poDatas[locale].items, false)
      }];
      return Promise.all(_.map(resultFiles, metadata => {
        let data = new Compiler(metadata.compilerOptions).format(localeList);
        data = metadata.postTransform ? metadata.postTransform(data) : data;
        const filename = _.isFunction(metadata.filename) ? metadata.filename(locale) : metadata.filename;
        const filepath = path.resolve(baseDir, filename);
        const module = compilation.findModule(filepath);
        if (module) {
          if (_.endsWith(module.request, '.json')) {
            module.buildInfo.jsonData = JSON.parse(data);
          }
          module._source = new OriginalSource(data, filepath);
          module._cachedSources.clear();
          module._initBuildHash(compilation);
          module.buildTimestamp = Date.now();
        }

        if (metadata.saveFile) {
          fs.writeFile(filepath, data, 'utf8', () => {});
        }
      }));
    });
    Promise.all(promiseList).finally(cb);
  }
}

function makePromiseCallback(resolve, reject) {
  return err => err ? reject(err) : resolve();
}

function mkdirSyncRecursive(directory) {
  var path = directory.replace(/\/$/, '').split('/');
  for (var i = 1; i <= path.length; i++) {
    var segment = path.slice(0, i).join('/');
    segment.length > 0 && !fs.existsSync(segment) ? fs.mkdirSync(segment) : null;
  }
};

AngularGettextPlugin.loader = require.resolve('./loader');

exports.default = AngularGettextPlugin;
