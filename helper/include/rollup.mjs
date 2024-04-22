
// ----------------------------------------------------------- On demand imports

let rollup;
let watch;

let run;
let sourcemaps;

// --------------------------------------------------------------------- Imports

import { resolveProjectPath,
         resolveConfigPath,
         resolveSrcPath,
         resolveDistPath } from './paths.mjs';

import { isFile, readJSONFile } from './fs.mjs';

import { setEnvVarsFromConfigFiles } from './env.mjs';

import { mergePackageJsons } from './npm.mjs';

import { asyncImport } from './import.mjs';

// ------------------------------------------------------------------- Internals

const EXTERNAL_PACKAGES =
  [
    'source-map',
    'arangojs',
    '@hapi/hapi',
    '@hapi/boom',
    '@hapi/inert',
    'http2',
    'os',
    'susie',
    'fs',
    'child_process',
    'url',
    'path',
    'process',
    'joi',
    'crypto',
    'stream',
    'util',
    'js-yaml',
    'jsonwebtoken',
    'redis'
  ];

// -------------------------------------------------------------------- Function

/**
 * Watch source code, build and run project in development mode
 */
export async function rollupRunInDevelopmentMode()
{
  await importDependencies();

  await checkPackageJsonExists();

  // ---------------------------------------------------------------------------
  // Set environment variables

  await setEnvVarsFromConfigFiles();

  // ---------------------------------------------------------------------------
  // Run rollup in watch mode

  const config =
    await readConfig(
      {
        fileName: 'rollup.dev.mjs',
        production: false
      } );

  const watchOptions =
    {
      ...config,

      watch: {
        buildDelay: 0,
        // chokidar
        clearScreen: true,

        // @note skipWrite=false: write to disk is required for plugin-run!
        skipWrite: false,

        exclude: [
          'dist/**',
          'doc/**',
          'node_modules/**',
          'hkdigital-jsdevtool/**'
        ]
      }
    };

  /**
   * Catch warnings generated by e.g. plugins
   *
   * @param {object} event
   * @param {object} event.message
   * @param {object} event.code
   * @param {object} event.plugin
   */
  watchOptions.onwarn = function ( event )
  {
    switch( event.plugin || null )
    {
      case 'sourcemaps':
        if( event.message === 'Failed reading file' )
        {
          // Ignore, an exception will be thrown on some pther place anyway
          return;
        }
        break;

      case null:
        if( 'UNRESOLVED_IMPORT' === event.code )
        {
          if( !event.message.startsWith('"node:') )
          {
            // Show a short warning about unresolved imports
            console.log();
            console.log(`Warning: ${event.message}`);
          }
          return;
        }
        else if( 'CIRCULAR_DEPENDENCY' === event.code )
        {
          // Ignore warnings about circular dependencies
          return;
        }
    }

    console.log();
    console.log('Warning:');
    console.log(
      {
        plugin: event.plugin || '',
        code: event.code || '',
        message: event.message || ''
      } );
  };

  // console.log("DEBUG: watchOptions", watchOptions);

  const watcher = watch( watchOptions );

  let startedAt = 0;

  // This will make sure that bundles are properly closed after each run
  watcher.on('event', async ( { code, result, error } ) =>
    {
      // console.log( { code } );

      switch( code )
      {
        case 'START':
          console.log();

          if( startedAt )
          {
            console.log('* Rollup: source changed -> rebundle');
          }

          startedAt = Date.now();
          break;

        // case "BUNDLE_START":
        //   console.log("Rollup: bundle start");

        //   break;

        // case "BUNDLE_END":
        //   console.log("Rollup: bundle ready");
        //   break;

        case 'ERROR':
          console.log();
          console.log('Rollup error:');
          console.log('-------------');

          delete error.watchFiles;

          console.log( error );
          console.log();
          break;

        case 'END':
          console.log();
          console.log(`* Rollup: bundled in [${Date.now() - startedAt}] ms`);
          console.log();

          // restartGeneratedOutputProgram();
          break;
      }

      if( result )
      {
        result.close();
      }

    } );
}

// -------------------------------------------------------------------- Function

/**
 * Build source code and write output to the `dist` folder
 */
export async function rollupBuildDist()
{
  await importDependencies();

  const startedAt = Date.now();

  await checkPackageJsonExists();

  const config =
    await readConfig(
      {
        fileName: 'rollup.build.mjs',
        production: true
      } );

  console.log('DEBUG: rollup config', config);

  let bundle;
  const buildFailed = false;

  try {
    bundle = await rollup( config );

    await bundle.write( config.output );
  }
  catch( error )
  {
    // buildFailed = true;
    console.log();
    console.log( 'Rollup build error:' );
    console.log( '-------------------' );

    delete error.watchFiles;

    console.error( error );
  }
  if( bundle )
  {
    // closes the bundle
    await bundle.close();
  }

  if( buildFailed )
  {
    console.error('* Rollup: build failed!');
    console.log();
    process.exit( 1 );
  }

  const { updated } =
    await mergePackageJsons(
      {
        outputPath: resolveDistPath('package.json'),
        includeDevDependencies: false,
        silent: true
      } );

  if( updated )
  {
    console.error('* Rollup: created package.json');
  }

  console.error(`* Rollup: build done [${Date.now() - startedAt}] ms`);
  console.log();
}

// -------------------------------------------------------------------- Function

/**
 * Execute the distribution output file (index.mjs) in the dist folder
 */
export async function rollupPreviewProjectFromDist()
{
  // const distPackageJsonPath = resolveDistPath("package.json");
  // await checkPackageJsonExists( distPackageJsonPath );

  await setEnvVarsFromConfigFiles();

  const distIndexJsPath = resolveDistPath('index.mjs');

  if( !await isFile( distIndexJsPath ) )
  {
    // Missing index file -> build first
    // await rollupBuildDist();
    console.log(`- Missing [${distIndexJsPath}]. Build project first.`);
    console.log();
    process.exit(1);
  }

  console.log();

  await asyncImport( distIndexJsPath );
}

// -------------------------------------------------------------------- Function

/**
 * Create a banner with information from the `package.json` file in the
 * project's root folder.
 * - Uses pkg.name, pkg.version, pkg.author from package.json
 *
 */
export async function createBannerFromPackageJson( )
{
  const pkg = await readJSONFile( resolveProjectPath('package.json') );

  if( !(pkg instanceof Object) )
  {
    throw new Error('Missing [pkg]');
  }

  if( typeof pkg.name !== 'string' )
  {
    throw new Error('Missing or invalid [pkg.name]');
  }

  if( typeof pkg.version !== 'string' )
  {
    throw new Error('Missing or invalid [pkg.version]');
  }

  if( typeof pkg.author !== 'string' )
  {
    throw new Error('Missing or invalid [pkg.author]');
  }

  return '/**\n'+
        ` * ${pkg.name} (${pkg.version})\n` +
        ` * Date: ${(new Date()).toISOString()}\n` +
        ` * Author: ${pkg.author}\n` +
        ' * License: see LICENSE.txt\n' +
        ' */\n\n';
}

// -------------------------------------------------------------------- Function

/**
 * Code to be added to banner of the generated code
 *
 * @returns {string} code
 */
export function onBootstrapReadyBannerCode()
{
  return 'const onBootstrapReadyFns = [];\n\n' +
         'function onBootstrapReady( fn ) {\n' +
         '  onBootstrapReadyFns.push( fn );\n' +
         '}\n\n';
}

// -------------------------------------------------------------------- Function

/**
 * Code to be added to footer of the generated code
 *
 * @returns {string} code
 */
export function onBootstrapReadyFooterCode()
{
  return '\nfor( const fn of onBootstrapReadyFns ) { fn(); }\n\n';
}

// -------------------------------------------------------------------- Function

/**
 * Read rollup config file
 *
 * @param {string} fileName
 * @param {boolean} [production=false]
 */
async function readConfig( { fileName, production=false })
{
  const configPath = resolveConfigPath( fileName );

  if( !await isFile( configPath ) )
  {
    const message = `Missing [${configPath}].`;
    console.log( message );
    console.log();
    process.exit(1);
  }

  const module_ = await asyncImport( configPath );

  if( typeof module_.createConfig !== 'function' )
  {
    console.log(`- Invalid config file [${configPath}].`);
    console.log('  Missing or invalid export: (async) function createConfig.');
    console.log();
    process.exit(1);
  }

  const config = await module_.createConfig();

  try {
    await normalizeConfig( config, { production } );
  }
  catch( e )
  {
    console.log(`- Invalid config file [${configPath}].`);
    console.log( e );
    console.log();
    process.exit(1);
  }

  // console.log( "config", config );

  return config;
}

// -------------------------------------------------------------------- Function

/**
 * Check and auto complete rollup config settings
 *
 * @param {object} config
 *
 * @returns {object} updated config
 */
async function normalizeConfig( config, { production=false } )
{
  if( !config.input )
  {
    config.input = resolveSrcPath( 'index.js' );
  }

  if( !config.output )
  {
    config.output = {};
  }
  else if( !(config.output instanceof Object) )
  {
    throw new Error('Invalid config. [config.output] should be an object');
  }

  const output = config.output;

  if( !config.plugins )
  {
    config.plugins = [];
  }
  else if( !Array.isArray( config.plugins ) )
  {
    throw new Error('Invalid config. [config.plugins] should be an array');
  }

  const plugins = config.plugins;

  // == Include source map plugin

  plugins.push( sourcemaps() );
  output.sourcemap = true;

  // == Set output format `ejs`

  if( !('format' in output) )
  {
    output.format = 'es';
  }

  // == Production / dev dependent config

  if( production )
  {
    // production

    if( !('banner' in output) )
    {
      config.banner = await createBannerFromPackageJson();
    }

    if( !('file' in output) )
    {
      output.file = 'dist/index.mjs';
    }
  }
  else {
    // dev

    if( !('file' in output) )
    {
      output.file = 'generated/index.mjs';
    }

    // == Use `run` plugin to execute the program

    plugins.push( run(
    {
      execArgv: ['--enable-source-maps']
    } ) );
  }

  const externalPackages = new Set( EXTERNAL_PACKAGES );

  if( 'external' in config )
  {
    //
    // Generate list of external packages automatically
    //
    for( const value of config.external )
    {
      externalPackages.add( value );
    }
  }

  await checkPackageJsonExists();

  //
  // Load dependencies defined in `package.json`
  //
  const pkg = await readJSONFile( resolveProjectPath('package.json') );

  const packageJsonDependencyNames =
    pkg.dependencies ? Object.keys( pkg.dependencies ) : [];

  for( const value of packageJsonDependencyNames )
  {
    externalPackages.add( value );
  }

  config.external = Array.from( externalPackages.values() );

  return config;
}

/* ---------------------------------------------------------------- Internals */

/**
 * Show a message and exit if no `package.json` was found in the project's
 * root folder
 */
async function checkPackageJsonExists()
{
  const packageJsonPath = resolveProjectPath('package.json');

  if( !await isFile( packageJsonPath ) )
  {
    const message =
    `
    Missing [package.json].

    Setup your project first by running:

    ./hkdigital-jsdevtool/setup-nodejs-backend.mjs
    `;
    console.log( message );
    process.exit(1);
  }
}

// -------------------------------------------------------------------- Function

/**
 * Dynamically import dependencies
 */
async function importDependencies()
{
  if( rollup )
  {
    return;
  }

  const rollupModule = await import('rollup');

  rollup = rollupModule.rollup;
  watch = rollupModule.watch;

  run = (await import( '@rollup/plugin-run' )).default;
  sourcemaps = (await import('@edugis/rollup-plugin-sourcemaps')).default;
}
