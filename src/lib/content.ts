import { getCollection, type CollectionEntry } from 'astro:content';

export async function getPublishedPosts() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

export async function getFeaturedPosts(limit = 3) {
  const posts = await getPublishedPosts();
  return posts.filter((post) => post.data.featured).slice(0, limit);
}

export async function getProjects() {
  const projects = await getCollection('projects');
  return projects.sort((a, b) => b.data.year - a.data.year);
}

export async function getFeaturedProjects(limit = 3) {
  const projects = await getProjects();
  return projects.filter((project) => project.data.featured).slice(0, limit);
}

export function getReadingMinutes(post: CollectionEntry<'blog'>) {
  const contentLength = post.body.replace(/\s+/g, '').length;
  return Math.max(1, Math.ceil(contentLength / 450));
}

export function getAllTags(posts: CollectionEntry<'blog'>[]) {
  return [...new Set(posts.flatMap((post) => post.data.tags))].sort((a, b) =>
    a.localeCompare(b, 'zh-Hans-CN'),
  );
}

export function getArchiveGroups(posts: CollectionEntry<'blog'>[]) {
  return posts.reduce<Record<string, CollectionEntry<'blog'>[]>>((acc, post) => {
    const key = `${post.data.pubDate.getFullYear()} 年`;
    acc[key] ??= [];
    acc[key].push(post);
    return acc;
  }, {});
}

export function getTagCountMap(posts: CollectionEntry<'blog'>[]) {
  return posts.reduce<Record<string, number>>((acc, post) => {
    for (const tag of post.data.tags) {
      acc[tag] = (acc[tag] ?? 0) + 1;
    }
    return acc;
  }, {});
}

export function getRelatedPosts(
  posts: CollectionEntry<'blog'>[],
  currentId: string,
  tags: string[],
  limit = 3,
) {
  return posts
    .filter((post) => post.id !== currentId)
    .map((post) => ({
      post,
      score: post.data.tags.filter((tag) => tags.includes(tag)).length,
    }))
    .sort((a, b) => b.score - a.score || b.post.data.pubDate.getTime() - a.post.data.pubDate.getTime())
    .filter((entry) => entry.score > 0)
    .slice(0, limit)
    .map((entry) => entry.post);
}
