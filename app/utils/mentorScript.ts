import type { StoneColor } from './goRules'
import type { MentorTone } from './mentor'
import type { TeachingPhase } from './teaching'

export interface ScriptContext {
  color: StoneColor
  moveLabel: string
  turn: number
  liberties: number
  capturedCount: number
  capturedLabel: string
  atariGroups: number
  bestLabel?: string
  phase: TeachingPhase
  connected: boolean
  edge: boolean
  isolated: boolean
  lowLiberties: boolean
}

type Need = 'alt' | 'capture' | 'atari' | 'connected' | 'edge' | 'isolated' | 'lowLiberties'

interface Template {
  text: (ctx: ScriptContext) => string
  needs?: Need
}

const TEMPLATES: Record<MentorTone, Template[]> = {
  praise: [
    {
      text: (ctx) =>
        `漂亮！${ctx.moveLabel} 这步下得很扎实，自己的棋气很足。你已经会看棋形了。`
    },
    {
      text: (ctx) => `稳。${ctx.moveLabel} 既照顾了自己，又盯着我的弱点，一石二鸟。`
    },
    {
      text: (ctx) =>
        `好棋！${ctx.moveLabel} 附近这块现在归你管了，我的子想进来得先问问你的气。`
    },
    {
      text: (ctx) =>
        `哦，这步有想法。${ctx.moveLabel} 把我这边的活动空间压小了，我得认真应对。`
    },
    {
      text: (ctx) =>
        `舒服的一手。${ctx.moveLabel} 不贪、不软，初学者能下出这种「本手」很不容易。`
    },
    {
      text: (ctx) =>
        `这手很自然——${ctx.moveLabel} 和你的子连成一片，我一下吃不掉你们。记住：棋要连。`,
      needs: 'connected'
    }
  ],
  encourage: [
    {
      text: (ctx) =>
        `嗯，${ctx.moveLabel} 不差，棋能活。不过你看蓝圈——如果下在 ${ctx.bestLabel}，我这块地会大一圈。你这步更稳，那步更大，看你想要哪种风格。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `能下。但坦白说，高手这时候更可能选 ${ctx.bestLabel}，那里能同时管住更多方向。你这步先求稳，也没问题。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `${ctx.moveLabel} 是「过得去」的一手。更积极的选择是 ${ctx.bestLabel}——差别不在对错，而在你想要的节奏。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `我看到你的思路了。${ctx.moveLabel} 守住了眼前，${ctx.bestLabel} 会更有攻势。两种都成立，先学会守也很重要。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `这步可以，但有点可惜。${ctx.bestLabel} 那边现在空着，谁先占到谁舒服。下次可以先看「最大的空地」。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `不错，至少没送子。想更进一步的话，${ctx.bestLabel} 会比 ${ctx.moveLabel} 更有价值一点。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `能下，中规中矩。落子前先看两件事：自己有没有危险，再看有没有更大的空地。${ctx.moveLabel} 已经落地，下一手接着练。`
    }
  ],
  'gentle-correct': [
    {
      text: (ctx) =>
        `哈哈，这步有点冒险——你这颗子现在只剩 ${ctx.liberties} 口气了（看橙色标记）。别慌，这正是学「气」的好机会。下一手试试救它；救不了我就「吃」了。`,
      needs: 'lowLiberties'
    },
    {
      text: (ctx) =>
        `我懂你为什么下 ${ctx.moveLabel}——想围地对吧？但我的子一伸进来，这堵墙就白建了。下次试试先在外面拦一下。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `${ctx.moveLabel} 这手有点急了。数一数：你的棋只剩 ${ctx.liberties} 口气，被叫吃了。先补一手，比抢地重要。`,
      needs: 'lowLiberties'
    },
    {
      text: (ctx) =>
        `这步踩到边线上了，${ctx.moveLabel} 在一线，很难围出地。边线可以走，但别把主力放这儿。`,
      needs: 'edge'
    },
    {
      text: (ctx) =>
        `嗯……这手把自己走重了。${ctx.moveLabel} 之后这块棋不太好跑。看看蓝色虚线的位置，高手会先轻一点处理。`,
      needs: 'alt'
    },
    {
      text: (ctx) =>
        `别急，这步只是「效率低」，不是世界末日。${ctx.moveLabel} 离你的大部队太远，孤零零一颗子很难活。试试靠近自己的棋下。`,
      needs: 'isolated'
    }
  ],
  excited: [
    {
      text: (ctx) =>
        `提了！！${ctx.capturedLabel || ctx.moveLabel} 这里 ${ctx.capturedCount} 颗子被你吃掉了！这就是「气」——气没了，子就死。爽不爽？`,
      needs: 'capture'
    },
    {
      text: () =>
        `你刚才那步叫「连接」——两颗子手拉手了，我现在一下吃不掉你们俩。这就是「棋要连」的道理。`,
      needs: 'connected'
    },
    {
      text: () =>
        `漂亮！你把我的棋逼到只剩一口气（叫吃，atari）。下一手就能提，别松手！`,
      needs: 'atari'
    },
    {
      text: (ctx) =>
        `看到了吗？${ctx.moveLabel} 一落，我这块棋的气全被堵死。吃子就这么简单——像捏住鼻子不让他呼吸。`,
      needs: 'capture'
    },
    {
      text: () =>
        `这手是「先手」！我不得不应，你抢到了节奏。围棋里，能让对方跟着你走，就是优势。`
    },
    {
      text: (ctx) =>
        `好眼光！${ctx.moveLabel} 正好卡在我两块棋中间，我左右都难受。`,
      needs: 'atari'
    }
  ],
  neutral: [
    {
      text: (ctx) =>
        `好，那我应一手——${ctx.moveLabel}。轮到你了，先数数双方的气，再决定下一手。`
    },
    {
      text: (ctx) =>
        `我下 ${ctx.moveLabel}。别急着抢地，先看看我这手有没有留下弱点。`
    },
    {
      text: (ctx) => `该我了。${ctx.moveLabel}，先站稳再说。围棋不是每一手都要打架。`
    },
    {
      text: (ctx) =>
        `我走 ${ctx.moveLabel}。留意一下你这边的气——别光顾着抢地，把自己走死了。`
    },
    {
      text: (ctx) =>
        `嗯，${ctx.moveLabel}。局面还早，慢慢来，先把每颗子的「气」数清楚。`
    }
  ],
  concerned: [
    {
      text: (ctx) =>
        `等一下——${ctx.moveLabel} 这步之前，你自己那边还有子只剩 ${ctx.liberties} 口气。先把自己的棋处理干净，再谈别的。`,
      needs: 'lowLiberties'
    },
    {
      text: (ctx) =>
        `慢着点。${ctx.moveLabel} 下过去了，可你自己那边有危险还没解决呢。围棋里自己的棋活了才算数。`,
      needs: 'lowLiberties'
    },
    {
      text: (ctx) => `别急。${ctx.moveLabel} 先记着一条：自己的棋有危险时，先救棋，再做别的。`
    }
  ],
  'teaching-moment': [
    {
      text: (ctx) => `注意到一个模式：${ctx.moveLabel} 这手值得你停下来看一眼。`
    },
    {
      text: (ctx) =>
        `咱们停一下。${ctx.moveLabel} 这一手背后有个比它本身更值得琢磨的问题。`
    }
  ]
}

function satisfies(template: Template, ctx: ScriptContext): boolean {
  switch (template.needs) {
    case 'alt':
      return Boolean(ctx.bestLabel)
    case 'capture':
      return ctx.capturedCount > 0
    case 'atari':
      return ctx.atariGroups > 0
    case 'connected':
      return ctx.connected
    case 'edge':
      return ctx.edge
    case 'isolated':
      return ctx.isolated
    case 'lowLiberties':
      return ctx.lowLiberties
    default:
      return true
  }
}

export function pickMessage(tone: MentorTone, ctx: ScriptContext, random = Math.random): string {
  const eligible = TEMPLATES[tone].filter((template) => satisfies(template, ctx))
  const pool = eligible.length > 0 ? eligible : TEMPLATES[tone].filter((t) => !t.needs)
  if (pool.length === 0) return `嗯，${ctx.moveLabel}。`
  return pool[Math.floor(random() * pool.length)].text(ctx)
}

export function illegalMoveMessage(
  label: string,
  reason: 'occupied' | 'out-of-bounds' | 'suicide' | 'ko'
): string {
  if (reason === 'occupied') {
    return `这里已经有子啦，${label} 不能重复落子。换个空的交叉点试试。`
  }
  if (reason === 'suicide') {
    return `${label} 是「自杀」——落下去之后你这块棋一口气都没有。规则不允许（除非它能提掉对方的子）。换个方向，先给自己留口气。`
  }
  if (reason === 'ko') {
    return `${label} 现在不能下——这是劫。上一手我提掉你一颗子，形成了劫，你不能立刻提回来。要提劫得先在别处下一手（找劫材），回来才能再提。`
  }
  return `这个点不在棋盘上，点棋盘里的交叉点就好。`
}

export function passMessage(color: StoneColor): string {
  if (color === 'white') {
    return '我没有更好的地方可下了，也停一手。'
  }
  return '你选择了停一手（pass）。这是合法的一手，通常留到收完官子再用；现在停手，我就继续下了。'
}
