export const siteConfig = {
  title: '刘强的博客',
  description: '记录 AI、编程、产品、写作与长期主义的中文个人站点。',
  siteUrl: 'https://usgpt.us',
  author: '刘强',
  intro: '把经验写清楚，把想法做出来，把长期有价值的东西留下来。',
  email: 'hi@usgpt.us',
  navigation: [
    { href: '/', label: '首页' },
    { href: '/blog', label: '博客' },
    { href: '/projects', label: '项目' },
    { href: '/archive', label: '归档' },
    { href: '/about', label: '关于' },
    { href: '/search', label: '搜索' },
  ],
  social: [{ href: 'https://github.com/jian-2582', label: 'GitHub' }],
  seo: {
    defaultOg: '/og/default-og.svg',
  },
} as const;

export const metrics = [
  { value: '6 年+', label: '持续记录与折腾' },
  { value: '30+', label: '长期可复用文章' },
  { value: '3 条线', label: 'AI、产品与技术实践' },
];

export const homeSections = [
  {
    eyebrow: '写作主题',
    title: '把复杂经验写成可复用的方法',
    description:
      '不是追热点，而是把工具、工作流、认知和踩坑沉淀成可以再次使用的结构化内容。',
  },
  {
    eyebrow: '站点形态',
    title: '博客、项目与个人品牌合一',
    description:
      '这不是一份模板博客，而是一座随内容一起成长的个人内容网站。',
  },
  {
    eyebrow: '技术原则',
    title: '轻量、稳定、可扩展',
    description:
      '静态优先、对象存储承载资源、自动部署发布，让维护成本长期保持可控。',
  },
];
