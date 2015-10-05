'use strict';

process.stdout.write('\u001B[2J\u001B[0;0f');

let fetch = require('node-fetch');
let Xray = require('x-ray');
let x = Xray();


let sections = {
	'realtime-new': {
		source: 'http://m.appledaily.com.tw/realtimenews/section/new/',
		scope: '.nm-articles ul li',
		selector: [{
			title: 'a .art-title-text',
			date: 'a .time',
			link: 'a@href'
		}],
		nextPage: '.pag.pag-next .ui-link', // first().attr('href')
		items: [],	// 抓好的資料放這裏
		range: 'today' // null | today | new Date() object
	},

	'realtime-focus': {
		source: 'http://m.appledaily.com.tw/realtimenews/section/recommend/page/1',
		scope: '.nm-articles ul li',
		selector: [{
			title: 'a .art-title-text',
			date: 'a .time',
			link: 'a@href'
		}],
		nextPage: null,
		items: [], // 抓好的資料放這裏
		range: null,
	}
}


// go( 'realtime-new' );
go( 'realtime-focus' );

function go( title ){

	let config = sections[title];

	// console.log( 'xray: ', Object.keys(x) );

	x.setConfig({
		limit: 3,
		paginate: '.pag.pag-next a@href'
	})

	x.pageEventHandler = function( evt ){
		console.log( '\n抓完一頁: ', evt.page,
					 '\n\t筆數: ', evt.payload.length,
					 '\n\t開頭: ', evt.payload[0].title,
					 '\n\t結尾: ', evt.payload[evt.payload.length-1].title );

		// return false 就是不要再抓下一頁，return true 代表不取消，不 return 也一樣
		// return false;
	}

	x( config.source,

		// 重要：先將 collection 選出來，後面的 selector 只能描述單筆 item 的 graph
		config.scope,

		config.selector )( (err, result) => {
			// console.log( '\n\nresult: ', result );
			config.items = [...config.items, ...result];
			// console.log( '抓取結束，總筆數: ', config.items.length );
			console.log( `\n\n抓取結束，總筆數: ${config.items.length}` );
		})

}

