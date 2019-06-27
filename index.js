const Extractor = require('angular-gettext-tools').Extractor;
const fs = require('fs');
const PO = require('pofile');
const path = require('path');
const _ = require('lodash');

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
        this.strings = {};
    }
    apply(compiler) {
        const self = this;
        const NO_CONTEXT = '$$noContext';

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

        compiler.hooks.emit.tapAsync('AngularGettextPlugin', function (compilation, cb) {
            const s = fs.readFileSync(path.resolve(__dirname, '../../../app/gettext/po/doorayWebApp.gettext.pot'), 'utf8');
            const oldPo = PO.parse(s);

            oldPo.items = _.reject(oldPo.items, item => {
                if (self.strings[item.msgid] && self.strings[item.msgid][item.msgctxt || NO_CONTEXT]) {
                    return true;
                }
            });
            fs.writeFileSync('po/templateCompare.pot',  oldPo.toString());

            fs.writeFile('po/template.pot',  Extractor.prototype.toString.call(self), cb);
        });

        compiler.hooks.compilation.tap('AngularGettextPlugin', function (compilation) {
            compilation.hooks.normalModuleLoader.tap('AngularGettextPlugin', function (loaderContext) {
                loaderContext.emitData = collectData
            });
        });
    }
}

AngularGettextPlugin.loader = require.resolve('./loader');

exports.default = AngularGettextPlugin;
