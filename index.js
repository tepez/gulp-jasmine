'use strict';
const path = require('path');
const arrify = require('arrify');
const PluginError = require('plugin-error');
const through = require('through2');
const Jasmine = require('jasmine');
const Reporter = require('jasmine-terminal-reporter');

function deleteRequireCache(id, paths) {
	if (!id || id.indexOf('node_modules') !== -1) {
		return;
	}

	if (paths) {
		paths.push(id);
	} else {
		paths = [id];
	}

	if (paths.indexOf(id) < paths.length - 1) {
		const separator = '\n -> ';
		throw new Error(`gulp-jasmine can't handle cyclic dependencies:${separator}${paths.join(separator)}`);
	}

	const files = require.cache[id];

	if (files !== undefined) {
		Object.keys(files.children).forEach(file => {
			deleteRequireCache(files.children[file].id, paths.slice());
		});

		delete require.cache[id];
	}
}

module.exports = (options = {}) => {
	const jasmine = new Jasmine();

	if (options.timeout) {
		jasmine.jasmine.DEFAULT_TIMEOUT_INTERVAL = options.timeout;
	}

	if (options.config) {
		jasmine.loadConfig(options.config);
	}

	const errorOnFail = options.errorOnFail === undefined ? true : options.errorOnFail;
	const color = !process.argv.includes('--no-color');
	const {reporter} = options;

	// Default reporter behavior changed in 2.5.2
	if (jasmine.env.clearReporters) {
		jasmine.env.clearReporters();
	}

	if (reporter) {
		for (const element of arrify(reporter)) {
			jasmine.addReporter(element);
		}
	} else {
		jasmine.addReporter(new Reporter({
			isVerbose: options.verbose,
			showColors: color,
			includeStackTrace: options.includeStackTrace
		}));
	}

	return through.obj((file, encoding, callback) => {
		if (file.isNull()) {
			callback(null, file);
			return;
		}

		if (file.isStream()) {
			callback(new PluginError('gulp-jasmine', 'Streaming not supported'));
			return;
		}

		// Get the cache object of the specs.js file,
		// delete it and its children recursively from cache
		const resolvedPath = path.resolve(file.path);
		const modId = require.resolve(resolvedPath);
		deleteRequireCache(modId);

		jasmine.addSpecFile(resolvedPath);

		callback(null, file);
	}, async function (callback) {
		const self = this;

		try {
			if (jasmine.helperFiles) {
				for (const helper of jasmine.helperFiles) {
					const resolvedPath = path.resolve(helper);
					const modId = require.resolve(resolvedPath);
					deleteRequireCache(modId);
				}
			}

			jasmine.onComplete(passed => {
				if (errorOnFail && !passed) {
					callback(new PluginError('gulp-jasmine', 'Tests failed', {
						showStack: false
					}));
				} else {
					self.emit('jasmineDone', passed);
					callback();
				}
			});

			await jasmine.execute();
		} catch (error) {
			callback(new PluginError('gulp-jasmine', error, {showStack: true}));
		}
	});
};
