'use strict';

/**
 * Module Dependencies
 */

var has = Object.prototype.hasOwnProperty;
var Crawler = require( 'x-ray-crawler' );
var assign = require( 'object-assign' );
var cheerio = require( 'cheerio' );
var enstore = require( 'enstore' );
var isUrl = require( 'is-url' );
var Batch = require( 'batch' );
var isArray = Array.isArray;
var fs = require( 'fs' );

/**
 * Locals
 */

var absolutes = require( './lib/absolutes' );
var resolve = require( './lib/resolve' );
var params = require( './lib/params' );
var walk = require( './lib/walk' );

/**
 * Debugs
 */

var debug = require( 'debug' )( 'x-ray' );
var error = require( 'debug' )( 'x-ray:error' );

/**
 * Crawler methods
 */

// jx: 免了，根本廢材沒用到，白癡寫的
// var methods = ['concurrency', 'throttle', 'timeout', 'driver', 'delay', 'limit'];

/**
 * Export
 */

module.exports = Xray;

/**
 * Initialize X-ray
 */

function Xray() {
	var crawler = Crawler();

	var state;

	// 重要，設定抓取參數
	var configBackup;
	xray.setConfig = function(cfg){
		state = cfg;
		configBackup = assign(cfg, {});
	}

	// override this
	xray.pageEventHandler = function( evt ){console.log( 'pageEventHandler 該被覆寫' );}

	function xray( source, scope, selector ) {

		// 整理參數
		var args = params( source, scope, selector );
		selector = args.selector;
		source = args.source;
		scope = args.context;

		// 設定初始狀態
		// 注意：他原始處理 state 變數範圍的手法很髒，容易混淆，因為將 global 與 local state 混在一起
		state = assign( {
			stream: false,	// 內部暫存用的
			concurrency: Infinity, // 根本沒用到

			paginate: false,

			limit: 2, // 預設抓 2 頁

		}, state || {} );


		var store = enstore();
		var pages = [];	// 爬多頁時，每頁的結果存於此
		var stream;

		// 之所以叫 node 是因為它負在 loop 每個 item 處理裏面的內容，會被呼叫多次
		// 真正的進入點，有兩種用途
		// 1、第一次跑時，x(...)(outerCallback) 只傳入一個參數 outerCallback
		// 	- 那是真正由外界傳入的
		// 2、之後會抓每個單筆資料時，source2 就是單筆 <li> 的內容
		// 	- 此時 outerCallBack 就是內部生成的 nodeCb()
		// 	- 會跑到 if else 的第三段，那裏面會真正取每個欄位的值
		function node( source2, outerCallback ) {



			if ( 1 == arguments.length ) {
				outerCallback = source2;
			} else {
				source = source2;
			}

			debug( 'params: %j', {
				source: source,
				scope: scope,
				selector: selector,
			} );

			// 每傳來一個 query selector node 可能有三種情況
			// 1、要抓另一頁內容繼續往下挖
			// 2、selector 裏有用 @ 指定 attr
			// 3、可直接用 selector 去每筆 <li> 內挖出欄位資料
			if ( isUrl( source ) ) {

				debug( 'starting at: %s', source );

				// 抓取進入點頁面
				// debugger; //開始抓頁面 1
				xray.request( source, function( err, html ) {

					if ( err ) return innerNext( err );

					// 將載入的 html 生成 cheerio 物件
					var $ = load( html, source );

					// 透過 html() 這支處理 cheerio 內容，並傳給它 innerNext fn
					node.html( $, innerNext.bind(this) );
				} );

			} else if ( scope && ~scope.indexOf( '@' ) ) {

				// ~ 就是 !==-1

				debug( 'resolving to a url: %s', scope )

				var url = resolve( source, false, scope );

				// ensure that a@href is a URL
				if ( !isUrl( url ) ) {
					debug( '%s is not a url!', url );
					return innerNext( new Error( url + ' is not a URL' ) );
				}

				debug( 'resolved "%s" to a %s', scope, url );
				// debugger; //開始抓頁面　２
				xray.request( url, function( err, html ) {
					if ( err ) return innerNext( err );
					var $ = load( html, url );
					node.html( $, innerNext.bind(this) );
				} );
			} else {
				// iterate 每個 <li> 時是進到這裏
				// `url` is probably HTML
				// debugger;
				var $ = load( source );

				// 將單個 node html 內容送去走訪內容
				// 做完後回呼 innerNext fn
				node.html( $, innerNext.bind(this) );
			}

			// 這支每處理好一個 node 後就會被呼叫，很頻繁
			// parsedObj 是已爬好的資料 {title: 'tt', date:'12', link:'cnn.com'}
			// parsedObj 有可能是單一筆資料，也可能是一頁完成後的 [objects]
			function innerNext( err, parsedObj, $, isOneItem ) {

				if ( err ) return outerCallback( err );
				var paginate = isOneItem ? false : state.paginate;
				var limit = isOneItem ? 8888 : --state.limit;

				// create the stream
				stream = stream
				? stream
				: ( paginate
							? stream_array( state.stream )
							: stream_object( state.stream ) )

				if ( paginate ) {

					// debugger;

					// 開抓下一頁前，先將本頁內容廣播出去
					// 東西在 parsedObj 裏面
					var returnedValue = xray.pageEventHandler({page: configBackup.limit - limit, payload: parsedObj})
					// console.log( '取消抓取下頁: ', returnedValue == false );

					if ( isArray( parsedObj ) ) {
						pages = pages.concat( parsedObj );
					} else {
						pages.push( parsedObj );
					}

					// returnedValue == false 代表用戶明確取消抓取下一頁
					if ( limit <= 0 || returnedValue == false ) {
						let msg = (returnedValue == false) ? '操作已被取消' : `所有頁面抓取完畢，共 ${configBackup.limit} 頁`;
						// console.log( `\n${msg}` );
						debug(msg);
						stream( parsedObj, true );
						return outerCallback( null, pages );
					}

					// resolve($, scope, selector, filters)
					// 找出下一頁的 url
					var url = resolve( $, false, paginate );
					debug( 'paginate(%j) => %j', paginate, url );

					if ( !isUrl( url ) ) {
						debug( '%j is not a url, finishing up', url );
						stream( parsedObj, true );
						return outerCallback( null, pages );
					}

					// 先把目前抓到的東西寫入 stream 保存起來
					stream( parsedObj );

					// debug
					debug( 'paginating %j', url );
					isFinite( limit ) && debug( '%s page(s) left to crawl', limit )

					// 開始撈下一頁內容
					// debugger; //開始抓頁面　３
					xray.request( url, function( err, html ) {
						if ( err ) return innerNext( err );

						// debugger;

						// 第二頁開始就是老路重演一次
						var $ = load( html, url );
						node.html( $, innerNext );
					} );

				} else {

					// 單筆 node 處理完都是進到這裏
					stream( parsedObj, true );	// true 代表 end，該 stream 只記錄一筆 obj 就結束
					outerCallback( null, parsedObj );
				}

			}

			return node;
		}

		//
		function load( html, url ) {
			var $ = html.html ? html : cheerio.load( html );

			// Change all the URLs into absolute urls
			if ( url ) $ = absolutes( url, $ );
			return $;
		}

		// === 開始往 node 身上加指令 ===

		// $ 是剛抓取完的 raw html 內容
		node.html = function( $, fnInnerNext ) {

			// jx: 這邊就是在處理 selector 內可能的 [{...}] graph 型態
			// selector 可能指定 string, array, object, array of object, array of array 五種型態
			// 並且因為每個 selector 內可能還要抓取更深層的 array，因此會再觸發一次 xray() 去抓取
			// batchNext: 這是 walk.js 裏 Batch 提供的 callback
			walk( selector,

			function handleOneSelector( v, k, batchNext ) {

				// debugger;

				if ( 'string' == typeof v ) {

					var value = resolve( $, root( scope ), v );

					// 這是 Batch 提供的 batchNext() fn
					// 因為此時已排隊了一堆 fn 要執行，這等於是 aysnc lib 的簡易版
					batchNext( null, value );

				} else if ( 'function' == typeof v ) {

					v( $, function( err, obj ) {
						if ( err ) return batchNext( err );
						batchNext( null, obj );
					} );

				} else if ( isArray( v ) ) {

					// == 要取的是 array of strings ==
					if ( 'string' == typeof v[0] ) {

						batchNext( null, resolve( $, root( scope ), v ) );

					} else if ( 'object' == typeof v[0] ) {

						// == 要取的是 array of objects ==

						// 如果要取 array of objects 代表前面一定要給 scope 限定範圍
						// 因此這裏先挖依該 scope 挖出所有 child nodes 內容
						var $scope = $.find ? $.find( scope ) : $( scope );

						// 計算 array 裏有多少筆 <li> 要處理
						var pending = $scope.length;
						var out = [];

						// Handle the empty result set (thanks @jenbennings!)
						if ( !pending ) return batchNext( null, out );

						// 然後走訪這些 child nodes
						// $scope 就是 array of <li>
						// 接著要一筆筆走訪 <li> ，按 selector 指定的欄位取值
						$scope.each( function( i, el ) {

							// 拉出單筆 item
							var $innerscope = $scope.eq( i );

							// jx: 每個 item 可能還要向下挖一層 query，因此又觸發一次 xray()
							// 注意完整的觸發指令是 xray(...)(fn)
							// 這裏只跑了第一階段，因此是拿回一個 node function，沒有真正執行開抓
							var node = xray( scope, v[0] );

							// 下面要跑 node(cb) 才真正處理該 node 內容的 html
							node( $innerscope, function nodeCb( err, obj ) {

								// console.log( '\t 處理完單頁 html' );

								if ( err ) return batchNext( err );

								// 抓完的東西存在這個 out[] 裏
								out[i] = obj;

								// --pending == 0 也就是沒更多資料要抓了
								if ( !--pending ) {
									// debugger;
									// console.log( '\n\n一頁抓完: ', out[0].title, ' > ', out[out.length - 1].title );
									return batchNext( null, compact( out ) );
								}
							} );
						} );
					}
				}
		}, // end handleOneSelector()


	  // 單筆資料處理完了
	  // 也用於整頁資料處理完
	  function singleWalkDone( err, arrResults ) {
		if ( err ) return fnInnerNext( err );

		// 將第一頁爬完的結果 arrResults 傳出去
		fnInnerNext( null, arrResults, $, isArray(arrResults) !== true );

	  });

	}

		/*// 加指令
		node.paginate = function( paginate ) {
			if ( !arguments.length ) return state.paginate;
			state.paginate = paginate;
			return node;
		}

		// 加指令
		node.limit = function( limit ) {
			if ( !arguments.length ) return state.limit;
			state.limit = limit;
			return node;
		}

		// 加指令
		// jx: 這造成發出第二次頁面請求，相同資料抓兩次
		// 我不需要透過它取得資料
		node.writeXX = function( path ) {
			var ret;

			if ( arguments.length ) {
				ret = state.stream = fs.createWriteStream( path );
			} else {
				state.stream = store.createWriteStream();
				ret = store.createReadStream();
			}

			node( function( err ) {
				if ( err ) state.stream.emit( 'error', err );
			} )

			return ret;
		}*/

		// 這是一個 WriteStream
		return node;
	}

	xray.request = function( url, fn ) {
		debug( 'fetching %s', url );
		crawler( url, function( err, ctx ) {
			if ( err ) return fn( err );
			debug( 'got response for %s with status code: %s', url, ctx.status );
			return fn( null, ctx.body );
		} )
	}

	// jx: 白癡手法，根本沒用到
	/*methods.forEach( function( method ) {
		xray[method] = function() {
			if ( !arguments.length ) return crawler[method]();
			crawler[method].apply( crawler, arguments );
			return this;
		};
	} );*/

	return xray;
}

//========================================================================
//
// 以下為 helper utils

/**
 * Get the root, if there is one.
 *
 * @param {Mixed}
 * @return {Boolean|String}
 */

function root( selector ) {
	return ( 'string' == typeof selector || isArray( selector ) )
	&& !~selector.indexOf( '@' )
	&& !isUrl( selector )
	&& selector;
}

/**
 * Compact an array,
 * removing empty objects
 *
 * @param {Array} arr
 * @return {Array}
 */

function compact( arr ) {
	return arr.filter( function( val ) {
		if ( null == val ) return false;
		if ( undefined !== val.length ) return 0 !== val.length;
		for ( var key in val ) if ( has.call( val, key ) ) return true;
		return false;
	} );
}

/**
 * Streaming array helper
 *
 * @param {Stream} data (optional)
 */

function stream_array( stream ) {
	if ( !stream ) return function() {};

	var first = true;

	return function _stream_array( data, end ) {
		var json = JSON.stringify( data, true, 2 );

		if ( first ) {
			stream.write( '[\n' );
			first = false;
		}

		if ( isArray( data ) ) {
			json = json.slice( 1, -1 );
		}

		if ( end ) {
			stream.end( json + ']' );
		} else {
			stream.write( json + ',' );
		}
	}
}

/**
 * Streaming object helper
 *
 * @param {Stream} data (optional)
 * @return {Function}
 */

function stream_object( stream ) {
	if ( !stream ) return function() {};

	var first = true;

	return function _stream_object( data, end ) {
		var json = JSON.stringify( data, true, 2 );

		if ( end ) {
			stream.end( json );
		} else {
			stream.write( json );
		}
	}
}
