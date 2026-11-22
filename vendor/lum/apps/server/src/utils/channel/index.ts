import { Toonflow } from "./toonflow";
import type { Channel, ExplorePage, HomeAdvertisements, Sponsor } from "./types";

async function exploreUnavailable(): Promise<never> {
  throw Object.assign(new Error("Lum 当前通过仓库提供探索资源"), { status: 404 });
}

class LumChannel extends Toonflow {
  override async getAdvertisements(): Promise<HomeAdvertisements> {
    return { banner: null, banners: [], bannerMode: "carousel", bannerInterval: 5, sidebar: [] };
  }

  override async getSponsorList(): Promise<Sponsor[]> {
    return [];
  }

  override async getExploreProjects(): Promise<ExplorePage> {
    return { source: "repository", categories: [], list: [], nextCursor: null };
  }

  override getExploreProject = exploreUnavailable;
  override getExploreProcess = exploreUnavailable;
  override getExploreDownload = exploreUnavailable;
  override getExploreUploadSignature = exploreUnavailable;
  override uploadExploreProject = exploreUnavailable;
}

const lum = new LumChannel();
const channels = new Map<string, Channel>([["lum", lum], ["toonflow", lum]]);

export function getChannel(): Channel {
  const source = channels.get((process.env.LUM_CHANNEL ?? process.env.TOONFLOW_CHANNEL)?.trim() || "lum");
  if (!source) throw Object.assign(new Error("渠道未配置，请检查 LUM_CHANNEL"), { status: 503 });
  return source;
}
