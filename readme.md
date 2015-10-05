
這是基於 x-ray 改來的 crawler

# 使用範例

	看 example.js

# 新增功能

	- setConfig(obj) 可設定各種參數

		xray.setConfig({
			limit: 2,
			paginate: 'ul li'
		})

	- limit 可給 Infinity 就會所有頁面全抓，給 2 就只抓兩頁

	- .paginate() 功能已修正，原本同一頁會抓兩次，然後第三頁就爛掉

	- 每抓完一頁會詢問是否要繼續
		- pageEventHandler() 內 return false 即可 cancel

	- 抓取中能看到 progress or event 嗎？
		- 因為我想判斷每條新聞的日期再決定是否要抓下頁

		← 沒辦法，因為是以整頁為單位先抓下來，然後走訪頁面上的10筆資料
		- 只能在 pageEventHandler 內判斷這批抓回來的10筆資料是否已重覆了，然後 return false 取消掉後續抓取
			- 並且將重覆的幾條 item 給刪掉

# 我改掉的部份

	- 將所有 chaining method 全拿掉，參數改用 config 傳入

	- write() 也會觸發 node() 再跑一次，能一律改成 promise 版嗎？
		- 這些列在 methods[] 中的指令已全拿掉

# 為何要用這個 lib 為基礎來改？
	- 可明確標示出 target graph 的結構，很清楚要抓哪些欄位，與它們相應的 query string
	- 可用 [{}] 來表示是要抓 Array of items
	- 因為他是 cheerio 作者，原本以為應該會很優

# 下一步
	- 目前此份 code 堪用，將來大規模 scale 時再找時間回來重寫
