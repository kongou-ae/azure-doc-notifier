'use strict';

import 'babel-polyfill'
var rp = require('request-promise');
var client = require('cheerio-httpcli');
var md5 = require('md5');
const hookUrl = process.env.hookUrl
const token = process.env.githubToken
const directory = process.env.targetDir
let dirRegex = new RegExp("/" + directory + "/")

module.exports.check = async(event, context, callback) => {

  // 最新100件のイベント一覧を返す
  const getEvents = async(i) => {
    return await rp({
      method: 'GET',
      uri: 'https://api.github.com/repos/Microsoft/azure-docs/events?page=' + i + '&per_page=100&rel=last&access_token=' + token,
      headers: {
        'User-Agent': 'Awesome-Octocat-App'
      },
      json: true 
    })
  }

  const getCommitDetail = async(commitUrl) => {
    return await rp({
      method: 'GET',
      uri: commitUrl + '?access_token=' + token,
      headers: {
        'User-Agent': 'Awesome-Octocat-App'
      },
      json: true 
    })
  }
  
  // コミットのURLを渡すと、コミットの中に含まれている対象ディレクトのdiff直リンクの配列が返ってくる
  const getUpdateInfo = async(commitUrl) => {

    let diffArr = [];
    let commitDetail = await getCommitDetail(commitUrl)
    for(let file of commitDetail.files){
      let diffObj = {};
      if (file.filename.match(dirRegex)){
        diffObj.commitUrl = commitDetail.html_url
        diffObj.filename = file.filename
        diffObj.anchor = md5(file.filename)
        diffArr.push(diffObj)
      }
    }
    return diffArr
  }
  
  // TeamsにWebhooする
  const sendHook = async (diffDetail) => {
    let mgs = {
      "text": 'Microsoft/azure-docs/' + diffDetail.filename + 'が更新されました。更新内容をチェックしましょう。',
      "potentialAction":[
        {
          "@context": "http://schema.org",
          "@type": "ViewAction",
          "name": "Githubにアクセス",
          "target": [diffDetail.commitUrl + "#diff-" + diffDetail.anchor]
        }
      ]
    }

    return await rp({
      method: 'POST',
      uri: hookUrl,
      body: mgs,
      json: true
    });
  }

  // 対象期間内のイベント一覧を返す
  const getEventArr = async () => {

    let i = 1
    let finishFlag = false
    let eventArr = []    
    
    while(finishFlag == false){
      console.log(i)
      for(let event of (await getEvents(i))){
        if(Date.parse(event.created_at) >= yesterday){
          eventArr.push(event)
        } else {
          finishFlag = true
        }
      }
      i++
    }
    return eventArr
  }

  // メイン処理
  const yesterday = Date.now() - 86400000
  // 対象のpushEventだけの配列を作る
  let eventArr = await getEventArr()
  console.log(eventArr.length)
  // azure-docのイベントをループ
  for (let event of eventArr){
    // リポジトリへのpushだけを対象
    if(event.type == 'PushEvent'){
      // マスターのみ
      if(event.payload.ref == 'refs/heads/master'){
        // 前回実行日時以降
        if(Date.parse(event.created_at) >= yesterday){
          // イベントに含まれるコミットをチェック
          for (let commit of event.payload.commits){
            // コミットから対象の変更情報を取得
            let diffArr = await getUpdateInfo(commit.url)
            // 配列が0よりも上＝更新があった
            if (diffArr.length > 0){
              for(let diffDetail of diffArr){
                sendHook(diffDetail)
                console.log("send webhook." + " " + diffDetail.filename + " " + diffDetail.commitUrl + "#diff-" + diffDetail.anchor)
              }
            }
          }
        }        
      }
    }    
  }

  context.succeed()
}