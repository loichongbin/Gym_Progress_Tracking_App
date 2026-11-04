// Global search across people, posts, exercises, communities and gyms.
import type { SearchResults } from "@/lib/types";
import { db, unwrap } from "./core";
import { PROFILE_CARD, toProfile } from "./mappers";
import { searchCommunities } from "./communities";
import { searchPosts } from "./posts";
import { listExercises } from "./workouts";

export async function search(query: string): Promise<SearchResults> {
  const q = query.trim().replace(/^@/, "").replace(/[%,()]/g, " ").trim();
  if (!q) return { people: [], posts: [], exercises: [], communities: [], gyms: [] };
  const [people, posts, exercises, communities, gyms] = await Promise.all([
    db().from("profiles").select(PROFILE_CARD).or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).limit(20),
    searchPosts(q),
    listExercises(q),
    searchCommunities(q),
    db().rpc("search_gyms", { p_query: q }),
  ]);
  return {
    people: unwrap(people).map(toProfile),
    posts,
    exercises: exercises.slice(0, 12),
    communities,
    gyms: unwrap(gyms).map((g) => ({ name: g.name, athletes: Number(g.athletes) })),
  };
}
