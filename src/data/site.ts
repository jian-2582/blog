export const siteConfig = {
  title: '刘强的个人工作台',
  description: '一个持续记录人工智能工具、自动化流程、个人网站与独立产品实践的中文站点。',
  siteUrl: 'https://usgpt.us',
  author: '刘强',
  intro: '这里写我正在做的事：人工智能工具、自动化流程、个人网站，以及把想法做成可用产品的过程。',
  email: 'hi@usgpt.us',
  navigation: [
    { href: '/', label: '首页' },
    { href: '/blog', label: '博客' },
    { href: '/projects', label: '项目' },
    { href: '/archive', label: '归档' },
    { href: '/about', label: '关于' },
    { href: '/search', label: '搜索' },
  ],
  social: [{ href: 'https://github.com/jian-2582', label: '代码仓库' }],
  seo: {
    defaultOg: '/og/default-og.svg',
  },
} as const;

export const metrics = [
  { value: '人工智能工具', label: '真实使用与落地' },
  { value: '自动化', label: '把流程做顺' },
  { value: '个人网站', label: '长期在线作品' },
];

export const homeSections = [
  {
    eyebrow: '当前关注',
    title: '把人工智能真正接进可重复的工作流',
    description:
      '我更关心人工智能怎样真正进入写作、整理、研究和发布，而不是只停留在演示层。',
  },
  {
    eyebrow: '站点定位',
    title: '把博客做成长期维护的个人工作台',
    description:
      '这里不只是发文章，也会持续记录项目、脚本、部署方案和每次真正踩过的坑。',
  },
  {
    eyebrow: '更新方式',
    title: '少说概念，多写可复用的过程',
    description:
      '我会尽量把每次搭建、修复和优化写成别人看完就能照着做的内容，而不是只给结论。',
  },
];
