import _ from 'lodash'
import { createRequire } from 'module'
import moment from 'moment'
import os from 'os'
import plugin from '../../../lib/plugins/plugin.js'
import { Config, Version, Plugin_Name } from '../components/index.js'
import { status } from '../constants/other.js'
import { State, common, puppeteer } from '../model/index.js'
import formatDuration from '../tools/formatDuration.js'
const require = createRequire(import.meta.url)

let interval = false
export class NewState extends plugin {
  constructor () {
    super({
      name: '椰奶状态',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: '^#?(椰奶)?(状态|监控)(pro)?$',
          fnc: 'state'
        }
      ]

    })
  }

  async monitor (e) {
    await puppeteer.render('state/monitor', {
      chartData: JSON.stringify(State.chartData)
    }, {
      e,
      scale: 1.4
    })
  }

  async state (e) {
    if (e.msg.includes('监控')) return this.monitor(e)

    if (!/椰奶/.test(e.msg) && !Config.whole.state) return false

    if (!State.si) return e.reply('❎ 没有检测到systeminformation依赖，请运行："pnpm add systeminformation -w"进行安装')

    // 防止多次触发
    if (interval) { return false } else interval = true
    // 系统
    let otherInfo = []
    // 其他信息
    otherInfo.push({
      first: '系统',
      tail: State.osInfo?.distro
    })
    // 网络
    otherInfo.push(State.getnetwork)
    // 插件数量
    otherInfo.push(State.getPluginNum)
    let promiseTaskList = [
      State.getFastFetch(e),
      State.getFsSize()
    ]

    // 网络测试
    let psTest = []
    let { psTestSites, psTestTimeout, backdrop } = Config.state
    State.chartData.backdrop = backdrop
    psTestSites && promiseTaskList.push(...psTestSites?.map(i => State.getNetworkLatency(i.url, psTestTimeout).then(res => psTest.push({
      first: i.name,
      tail: res
    }))))
    // 执行promise任务
    let [FastFetch, HardDisk] = await Promise.all(promiseTaskList)
    // 可视化数据
    let visualData = _.compact(await Promise.all([
      // CPU板块
      State.getCpuInfo(),
      // 内存板块
      State.getMemUsage(),
      // GPU板块
      State.getGPU(),
      // Node板块
      State.getNodeInfo()
    ]))

    /** bot列表 */
    let BotList = [e.self_id]

    if (e.msg.includes('pro')) {
      if (Array.isArray(Bot?.uin)) {
        BotList = Bot.uin
      } else if (Bot?.adapter && Bot.adapter.includes(e.self_id)) {
        BotList = Bot.adapter
      }
    }
    // 渲染数据
    let data = {
      BotStatus: await getBotState(BotList),
      chartData: JSON.stringify(common.checkIfEmpty(State.chartData, ['echarts_theme', 'cpu', 'ram']) ? undefined : State.chartData),
      // 硬盘内存
      HardDisk,
      // FastFetch
      FastFetch,
      // 硬盘速率
      fsStats: State.DiskSpeed,
      // 可视化数据
      visualData,
      // 其他数据
      otherInfo: _.compact(otherInfo),
      psTest: _.isEmpty(psTest) ? false : psTest
    }

    // 渲染图片
    await puppeteer.render('state/state', {
      ...data
    }, {
      e,
      scale: 1.4
    })

    interval = false
  }
}
const getBotState = async (botList) => {
  const defaultAvatar = `../../../../../plugins/${Plugin_Name}/resources/state/img/default_avatar.jpg`
  const BotName = Version.name
  const systime = formatDuration(os.uptime(), 'dd天hh小时mm分', false)
  const calendar = moment().format('YYYY-MM-DD HH:mm:ss')

  const dataPromises = botList.map(async (i) => {
    const bot = Bot[i]
    if (!bot?.uin) return ''

    const avatar = bot.avatar || (Number(bot.uin) ? `https://q1.qlogo.cn/g?b=qq&s=0&nk=${bot.uin}` : defaultAvatar)
    const nickname = bot.nickname || '未知'
    const onlineStatus = status[bot.status] || '在线'
    const platform = bot.apk ? `${bot.apk.display} v${bot.apk.version}` : bot.version?.version || '未知'

    const sent = await redis.get(`Yz:count:send:msg:bot:${bot.uin}:total`) || await redis.get('Yz:count:sendMsg:total')
    const recv = await redis.get(`Yz:count:receive:msg:bot:${bot.uin}:total`) || bot.stat?.recv_msg_cnt
    const screenshot = await redis.get(`Yz:count:send:image:bot:${bot.uin}:total`) || await redis.get('Yz:count:screenshot:total')

    const friendQuantity = bot.fl?.size || 0
    const groupQuantity = bot.gl?.size || 0
    const groupMemberQuantity = Array.from(bot.gml?.values() || []).reduce((acc, curr) => acc + curr.size, 0)
    const runTime = formatDuration(Date.now() / 1000 - bot.stat?.start_time, 'dd天hh小时mm分', false)
    const botVersion = bot.version ? `${bot.version.name}(${bot.version.id})${bot.apk ? ` ${bot.version.version}` : ''}` : `ICQQ(QQ) v${require('icqq/package.json').version}`

    return `<div class="box">
      <div class="tb">
          <div class="avatar">
              <img src="${avatar}"
                  onerror="this.src= '${defaultAvatar}'; this.onerror = null;">
          </div>
          <div class="header">
              <h1>${nickname}</h1>
              <hr noshade>
              <p>${onlineStatus}(${platform}) | ${botVersion}</p>
              <p>收${recv || 0} | 发${sent || 0} | 图片${screenshot || 0} | 好友${friendQuantity} | 群${groupQuantity} | 群员${groupMemberQuantity}</p>
              <p>${BotName} 已运行 ${runTime} | 系统运行 ${systime}</p>
              <p>${calendar} | Node.js ${process.version} | ${process.platform} ${process.arch}</p>
          </div>
      </div>
  </div>`
  })

  const dataArray = await Promise.all(dataPromises)
  return dataArray.join('')
}
