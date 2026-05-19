import type { ArticleStyle } from '../../core/types';

// ----------------------------------------------------------------
// 风格模板定义
// ----------------------------------------------------------------

export interface StyleTemplate {
  key: ArticleStyle;
  label: string;
  icon: string;
  description: string;
  /** 注入到 system prompt 的风格指令 */
  stylePrompt: string;
  /** 该风格推荐的大纲结构提示 */
  structureHint: string;
  /** 典型适用场景 */
  useCases: string[];
}

export const STYLE_TEMPLATES: Record<ArticleStyle, StyleTemplate> = {

  'tech-blog': {
    key: 'tech-blog',
    label: '技术博客',
    icon: '💻',
    description: '面向开发者，代码优先，结构清晰',
    stylePrompt:
      '使用技术博客风格写作。语言简洁专业，适当穿插代码示例和命令行片段，' +
      '使用 Markdown 代码块（```language）包裹代码，标题层次分明，结论明确。',
    structureHint:
      '建议结构：背景/动机 → 核心概念 → 实现步骤 → 代码示例 → 总结与延伸阅读',
    useCases: ['技术教程', '工具介绍', '踩坑记录', '原理解析']
  },

  'wechat': {
    key: 'wechat',
    label: '公众号软文',
    icon: '📱',
    description: '轻松易读，情感共鸣，适合传播',
    stylePrompt:
      '使用微信公众号文章风格写作。语言生动亲切，段落控制在 3-4 句以内，' +
      '多用金句、故事和类比，开头要有钩子抓住读者，结尾有互动引导。' +
      '适合在手机上竖屏阅读，避免大段密集文字。',
    structureHint:
      '建议结构：开头钩子（故事/反问/数字） → 核心内容（3-5 个段落） → 金句总结 → 互动引导',
    useCases: ['知识科普', '经验分享', '观点输出', '行业洞察']
  },

  'zhihu': {
    key: 'zhihu',
    label: '知乎答题',
    icon: '🎯',
    description: '有深度，有观点，逻辑严密',
    stylePrompt:
      '使用知乎回答风格写作。开头先亮明核心观点（不超过 2 句），再逐步展开论证，' +
      '引用数据、案例或权威来源支撑观点，有批判性思维，结尾有简洁的总结。',
    structureHint:
      '建议结构：核心结论（一句话） → 为什么这样认为（3 条论据） → 案例/数据支撑 → 反驳常见误区 → 总结',
    useCases: ['观点输出', '问题解答', '方案对比', '认知纠偏']
  },

  'abstract': {
    key: 'abstract',
    label: '论文摘要',
    icon: '📜',
    description: '学术严谨，客观中立',
    stylePrompt:
      '使用学术摘要风格写作。语言客观严谨，使用第三人称，避免口语化表达，' +
      '包含研究背景、方法、主要发现和结论四个要素，每句话信息密度高。',
    structureHint:
      '建议结构：研究背景与动机 → 方法/技术路径 → 主要发现/结果 → 结论与意义',
    useCases: ['研究总结', '学术报告', '技术白皮书', '调研报告']
  },

  'tutorial': {
    key: 'tutorial',
    label: '教程手册',
    icon: '📚',
    description: '步骤清晰，手把手指导',
    stylePrompt:
      '使用教程手册风格写作。包含前置条件说明，步骤编号清晰（Step 1, Step 2...），' +
      '每步说明操作、原因和预期结果，出错处理用 ⚠️ 标注，' +
      '代码示例完整可运行，结尾有检验成功的方法。',
    structureHint:
      '建议结构：前置条件 → 快速预览（TL;DR） → 分步骤正文 → 验证方法 → 常见问题',
    useCases: ['操作指南', '快速上手', '配置手册', '部署文档']
  },

  'newsletter': {
    key: 'newsletter',
    label: '邮件周报',
    icon: '📧',
    description: '简洁摘要，重点突出',
    stylePrompt:
      '使用邮件周报风格写作。开头一段执行摘要（3 句话概括全文），' +
      '正文用分块标题组织，每块内容简短精炼，' +
      '多用列表，便于快速扫读，结尾有行动项（Action Items）。',
    structureHint:
      '建议结构：执行摘要 → 核心内容块（3-5 个） → 关键数据/亮点 → 行动项/下一步',
    useCases: ['周报日报', '项目进展', '技术动态', '学习总结']
  },

  'linkedin': {
    key: 'linkedin',
    label: 'LinkedIn 文章',
    icon: '💼',
    description: '专业洞察，职场视角',
    stylePrompt:
      '使用 LinkedIn 文章风格写作。从职业发展或行业角度切入，' +
      '有专业洞察和个人经验分享，语气自信但不失亲和力，' +
      '段落短，便于移动端浏览，结尾有观点引发讨论。',
    structureHint:
      '建议结构：个人经历引入 → 核心洞察（3 点） → 实践建议 → 行业趋势展望 → 互动提问',
    useCases: ['职场心得', '行业趋势', '技能分享', '求职经验']
  },

  'documentation': {
    key: 'documentation',
    label: '技术文档',
    icon: '📋',
    description: '规范标准，完整全面',
    stylePrompt:
      '使用技术文档风格写作。格式严格规范，包含必要的类型说明、参数描述和示例，' +
      '使用标准 Markdown 格式，表格用于参数列表，代码块标注语言类型，' +
      '注意事项用 > ⚠️ 引用块标注。',
    structureHint:
      '建议结构：概述 → 快速开始 → 详细说明 → API/参数参考 → 示例 → 常见问题',
    useCases: ['API 文档', '系统设计', '规范说明', '接口文档']
  },

  'casual': {
    key: 'casual',
    label: '轻松随笔',
    icon: '✍️',
    description: '个人感悟，随性表达',
    stylePrompt:
      '使用随笔风格写作。语言轻松自然，像在和朋友聊天，可以有个人情感和感悟，' +
      '不需要严格的论证结构，娓娓道来，有温度，允许离题思考。',
    structureHint:
      '建议结构：由某件事/某个场景引入 → 自然展开联想 → 个人感悟 → 开放式结尾',
    useCases: ['个人随想', '读书感悟', '生活观察', '学习心得']
  },

  'summary': {
    key: 'summary',
    label: '内容总结',
    icon: '📝',
    description: '提炼要点，高效浓缩',
    stylePrompt:
      '使用总结报告风格写作。高度凝练，去除冗余，' +
      '核心信息用列表呈现，每条要点不超过 2 句话，' +
      '保留数字和关键词，可以加黑体强调最重要的内容。',
    structureHint:
      '建议结构：核心结论（TL;DR） → 主要要点列表 → 关键数据/案例 → 延伸方向',
    useCases: ['会议纪要', '书籍总结', '课程笔记', '内容精华']
  }

};

// ----------------------------------------------------------------
// 工具函数
// ----------------------------------------------------------------

/** 获取所有风格模板，返回数组（用于渲染选择器） */
export function getAllStyles(): StyleTemplate[] {
  return Object.values(STYLE_TEMPLATES);
}

/** 根据 key 获取风格模板 */
export function getStyleTemplate(style: ArticleStyle): StyleTemplate {
  return STYLE_TEMPLATES[style];
}

/**
 * 生成大纲 system prompt
 * @param style    文章风格
 * @param length   长度预设
 * @param sections 建议章节数
 */
export function buildOutlineSystemPrompt(
  style: ArticleStyle,
  lengthLabel: string,
  sections: number
): string {
  const tpl = STYLE_TEMPLATES[style];
  return [
    `你是一位专业的内容策划师，擅长 ${tpl.label} 风格的写作。`,
    '',
    `## 风格要求`,
    tpl.stylePrompt,
    '',
    `## 结构建议`,
    tpl.structureHint,
    '',
    `## 任务`,
    `请为用户提供的主题生成一份详细的文章大纲。`,
    `文章长度目标：${lengthLabel}，建议 ${sections} 个主要章节。`,
    '',
    `## 输出格式（严格 JSON）`,
    '```json',
    '{',
    '  "title": "文章标题",',
    '  "oneLiner": "一句话摘要（不超过 30 字）",',
    '  "targetAudience": "目标读者描述",',
    '  "totalEstimatedWords": 1500,',
    '  "sections": [',
    '    {',
    '      "id": "s1",',
    '      "level": 1,',
    '      "title": "章节标题",',
    '      "keyPoints": ["要点1", "要点2", "要点3"],',
    '      "estimatedWords": 300',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '只输出 JSON，不要有任何额外说明。'
  ].join('\n');
}

/**
 * 生成正文 system prompt
 */
export function buildArticleSystemPrompt(style: ArticleStyle): string {
  const tpl = STYLE_TEMPLATES[style];
  return [
    `你是一位专业的 ${tpl.label} 作者。`,
    '',
    `## 写作风格`,
    tpl.stylePrompt,
    '',
    `## 格式要求`,
    '- 使用标准 Markdown 格式输出',
    '- 标题使用 ## 和 ###（不要用 # 一级标题，由外部控制）',
    '- 代码使用代码块，指定语言',
    '- 重要概念可用 **加粗** 强调',
    '- 列表项简洁清晰',
    '',
    `## 质量要求`,
    '- 内容充实，有具体细节，不空泛',
    '- 逻辑清晰，段落之间有自然过渡',
    '- 避免重复用词，语言多样',
    '- 结尾有力，给读者留下印象'
  ].join('\n');
}