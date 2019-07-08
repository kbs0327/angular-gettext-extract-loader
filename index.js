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
            return _newRefs.any(function (newRef) {
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
        this.strings = {};
        this.oldStrings = {};
    }
    apply(compiler) {
        const self = this;
        const NO_CONTEXT = '$$noContext';
        let firstRun = true;

        function collectData(request, data) {
            _.forEach(data, (value, key) => {
                value = castingAsPoItem(value);
                let existing = self.strings[key];
                if (!existing) {
                    self.strings[key] = value;
                    return;
                }

                const item = value[NO_CONTEXT];
                existing = existing[NO_CONTEXT];
                if (item && existing) {
                    existing.comments = _.uniq(existing.comments.concat(item.comments)).sort();
                    existing.references = mergeReferences(item.references, existing.references);
                    return;
                }
                self.strings[key] = _.assign(self.strings[key], value)
            });
        }

        const createDummyFiles = (compiler, cb) => {
            if (!firstRun) {
                return cb();
            }
            firstRun = false;
            const compilerOptions = this.options.compiler;
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
                loaderContext.emitData = collectData
            });

            compilation.hooks.finishModules.tapAsync('AngularGettextPlugin', (modules, cb) => {
                this.hasExtraKeys = _.some(this.strings, (value, key) => {
                    const oldValue = this.oldStrings[key];
                    return !oldValue || !_.every(_.keys(value), context => oldValue[context]);
                })
                if (!this.hasExtraKeys) {
                    return cb();
                }
                this.oldStrings = this.strings;

                if (this.options.pofile) {
                    Promise.all(_.map(this.options.langList, lang => new Promise(resolve => {
                        fs.writeFile(this.options.pofile, Extractor.prototype.toString.call(this, lang), resolve);
                    }))).then(cb);
                }

                if (this.options.saveCallback) {
                    this.options.saveCallback(Extractor.prototype.toPo.call(this), makeSaveCallbackCb(compilation, cb));
                }
            });
        });

    }
}

function makeSaveCallbackCb(compilation, cb) {
    return (
        langList, poDatas, {baseDir, resultFiles} = {}
    ) => {
        if (!poDatas) {
            return cb();
        }
        const promiseList = _.map(langList, locale => {
            const localeList = [{
                locale,
                strings: Compiler.parsePoItems(poDatas[locale].items)
            }];
            return Promise.all(_.map(resultFiles, metadata => {
                let data = new Compiler(metadata.compilerOptions).format(localeList);
                data = metadata.postTransform ? metadata.postTransform(data) : data;
                const filename = _.isFunction(metadata.filename) ? metadata.filename(locale) : metadata.filename;
                const filepath = path.resolve(baseDir, filename);
                const module = compilation.findModule(filepath);
                return new Promise((resolve) => {
                    fs.writeFile(filepath, data, 'utf8', err => {
                        if (module) {
                            if (_.endsWith(module.request, '.json')) {
                                module.buildInfo.jsonData = JSON.parse(data);
                            }
                            module._source = new OriginalSource(data, filepath);
                            module._cachedSources.clear();
                            module.buildTimestamp = Date.now();
                        }
                        resolve();
                    });
                });
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
