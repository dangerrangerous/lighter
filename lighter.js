var chug = require('chug');
var colors = require('colors');
var fs = require('fs');
var log = console.log; // TODO: Use bunyan or winston.
var cwd = process.cwd();

var httpPort = 9080;
var httpsPort = 9443;
var httpsKey = null;
var httpsCert = null;

var lighter = module.exports = function () {
	var App = require('./lib/App');
	app = app || new App();
	return app;
};

var app;
var controllers = lighter._controllers = [];
var publics = lighter._publics = [];
var scripts = lighter._scripts = [];
var styles = lighter._styles = [];
var views = lighter._views = [];

var rewritePath = function (path) {
	return path;
};

/**
 * Expose the version to module users.
 */
lighter.version = require('./package.json').version;

/**
 * Expected environments are "dev", "test", "stage", "canary", "prod".
 */
lighter._env = process.env.NODE_ENV || 'prod';

/**
 * Allow external public files to be added.
 */
lighter.addPublics = function (item) {
	publics.push(item);
};

/**
 * Allow external scripts to be added.
 */
lighter.addScripts = function (item) {
	scripts.push(item);
};

/**
 * Allow external styles to be added.
 */
lighter.addStyles = function (item) {
	styles.push(item);
};

/**
 * Allow external views to be added.
 */
lighter.addViews = function (item) {
	views.push(item);
};

/**
 * Swap out the app server for a different one (like Express).
 */
lighter.setApp = function (value) {
	app = lighter._app = value;
};

/**
 * Set the port to be used for HTTP.
 */
lighter.setHttpPort = function (value) {
	httpPort = value;
};

/**
 * Set the port to be used for HTTPS.
 */
lighter.setHttpsPort = function (value) {
	httpsPort = value;
};

/**
 * Ascii art to be shown on startup.
 */
var asciiArt = ['',
	'     .A.     '.red + ("  _    _       _     _      v" + lighter.version).grey,
	'    /@@@\\    '.red + " | |  (_) __ _| |__ | |_ ___ _ __".grey,
	'  ./@@'.red + 'A'.yellow + '@@\\.  '.red + " | |  | |/ _` | '_ \\| __/ _ \\ '__|".grey,
	' /@@'.red + '/@@@\\'.yellow + '@@\\ '.red + " | |__| | (_| | | | | ||  __/ |".grey,
	'/@@'.red + '/@@'.yellow + 'A'.white + '@@\\'.yellow + '@@\\'.red + " |____|_|\\__, |_| |_|\\__\\___|_|".grey,
	'#@@'.red + '#@'.yellow + '/@\\'.white + '@#'.yellow + '@@#'.red + "          |___/".grey,
	'#@@'.red + '#@'.yellow + '@@@'.white + '@#'.yellow + '@@#  '.red,
	'"#@@'.red + '\\@@@/'.yellow + '@@#"  '.red,
	' \'"#######"\'   '.red,
	''];

lighter.setAsciiArt = function (value) {
	asciiArt = value;
};

/**
 * Initialize the framework after the calling module has had a chance to
 * add assets and modify defaults using the API.
 */
setImmediate(function () {

	if (!(httpsKey && httpsCert)) {
		httpsPort = null;
	}
	if (!app) {

		// Mitigate circular dependency.
		var App = require('./lib/App');

		// Ensure the _app key gets written too.
		lighter.setApp(new App());

		// Augment http.ClientRequest and http.ServerResponse.
		require('./lib/http');
	}
	app.listen(httpPort, httpsPort);

	// Announce the app.
	try {
		var caller = require(cwd + '/package.json');
		asciiArt[asciiArt.length - 3] += 'App: '.grey + caller.name + ' v' + caller.version;
		if (httpPort || httpsPort) {
			asciiArt[asciiArt.length - 2] += 'URL: '.grey;
		}
		if (httpPort) {
			asciiArt[asciiArt.length - 2] += 'http://localhost:' + httpPort + '/';
		}
		if (httpPort && httpsPort) {
			asciiArt[asciiArt.length - 2] += ' or ';
		}
		if (httpsPort) {
			asciiArt[asciiArt.length - 2] += 'https://localhost:' + httpsPort + '/';
		}
	}
	catch (e) {
		throw 'A package.json must exist in the directory Lighter is called from.';
	}
	log(asciiArt.join('\n'));

	// Pass the lighter app to Chug so it can route static assets.
	chug.setApp(app);
	chug.enableShrinking();

	controllers.push('controllers');
	controllers = chug(controllers).require(function (Controller) {
		var controller = new Controller();
		var path = rewritePath(this.location.substr(cwd.length + 12).replace(/(|[iI]ndex)(|_?[cC]ontroller)\.[a-z]+$/, ''));
		for (var property in controller) {
			if (typeof controller[property] == 'function') {
				(function (action) {
					if (/(GET|PUT|POST|DELETE)/.test(action.name)) {
						var url = path + (property == 'index' ? '' : '/' + rewritePath(property));
						var methods = action.name.match(/(GET|PUT|POST|DELETE)/g);
						methods.forEach(function (method) {
							method = method.toLowerCase();
							app[method](url, function () {
								action.apply(controller, arguments);
							});
						});
					}
				})(controller[property]);
			}
		}
	});
	verbosify(controllers, "Controller");

	// TODO: Allow an override for this.
	publics.push('public');
	publics = chug(publics).compile().route().watch();
	verbosify(publics, "Public file");

	// TODO: Allow an override for this.
	views.push('views');
	views = chug(views).compile().watch();
	verbosify(views, "View");

	// TODO: Allow an override for this.
	scripts.push('scripts');
	scripts = chug(scripts).compile().watch();
	var allScripts = scripts.concat('/all.js').route();
	verbosify(scripts, "Script");

	// TODO: Allow an override for this.
	styles.push('styles');
	styles = chug(styles).compile().watch();
	var allStyles = styles.concat('/all.css').route();
	verbosify(styles, "Style");

	chug.onceReady(function () {


		lighter._views = {};
		views.assets.forEach(function (asset) {
			var name = asset.location.replace(/(^.*\/views\/|\.[a-z]+$)/g, '');
			lighter._views[name] = asset;
		});
		lighter._scripts = scripts.assets;
		lighter._styles = styles.assets;

		if (lighter._env == 'dev') {

			// Watch app directories that aren't already being watched.
			watchAndExit(cwd, /^(\..*|controllers|coverage|node_modules|public|scripts|styles|test|views)$/);

			// For lighter development (for now, for framework development).
			watchAndExit(cwd + '/node_modules/lighter', /^node_modules$/);

		}
		else {
			log("Minifying assets... " + "(to disable, run with \"NODE_ENV=dev node app\")".grey);
			views.minify();
			allScripts.minify();
			allStyles.minify();
			chug.onceReady(function () {
				log("Views, scripts and styles minified.");
			});

		}

	});

	// TODO: Once we're using bunyan or something, make these go in as verbose logs?
	function verbosify(load, singular) {
		load
			.onceReady(function () {
				log(singular + "s loaded. " + ("x" + load.assets.length).grey);
			})
			.watch(function () {
				log(singular + "s reloaded.");
			});
	}

	// TODO: Maybe move this to Chug and implement Windows-compatible watching there.
	var watchCount = 0;
	function watchAndExit(dir, ignorePattern) {
		try {
			watchCount++;
			if (watchCount < 4e2) {
				fs.watch(dir, function () {
					console.log("Exiting due to core file change.");
					console.log("To run indefinitely, use:\n  " + '"while true; do NODE_ENV=dev node app; done"');
					process.exit();
				});
			}
		}
		catch (e) {
			// Fail silently for now.
			// fs.watch is not stable, particularly on Mac OS.
		}
		fs.readdir(dir, function (err, files) {
			if (err) {
				// If we can't watch this dir, it probably doesn't matter.
				return;
			}
			files.forEach(function (file) {
				if (!ignorePattern.test(file)) {
					var path = dir + '/' + file;
					fs.stat(path, function (err, stat) {
						if (stat.isDirectory()) {
							watchAndExit(path, ignorePattern);
						}
					});
				}
			});
		});
	}
});