import rss from '@astrojs/rss';
import { getPublishedPosts } from '../lib/content';
import { siteConfig } from '../data/site';

export async function GET(context) {
  const posts = await getPublishedPosts();
  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site: context.site ?? siteConfig.siteUrl,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
    })),
    customData: '<language>zh-cn</language>',
  });
}
