export type RequestOptions = { signal?: AbortSignal };
export type AuthenticatedOptions = RequestOptions & { token: string };

export type PluginType = "node" | "tool" | "skill" | "agent" | "ext";
export type PluginIdentity = { type: PluginType; identifier: string };
export type PluginExistence = PluginIdentity & { exists: boolean };
export type Plugin = {
  id: number;
  identifier: string;
  type: PluginType;
  name: string;
  state: 0 | 1 | 2;
  version?: string;
  supplier?: string;
  desc?: string;
  link?: string;
  fileName?: string;
  isCollected?: boolean;
  rejectReason?: string;
  tags?: { text: string; color: string }[];
  demoVideoUrl?: string;
  coverUrl?: string;
};
export type PluginsParams = { page: number; limit: number; type: PluginType | "all" | "my" | "collection"; searchKeyword?: string };
export type UploadPluginParams = { name: string; identifier: string; type: PluginType; desc?: string; fileBase64: string; fileName: string; version: string; demoVideoKey?: string; coverKey?: string };
export type UpdatePluginParams = { id: number; name: string; desc?: string; fileBase64: string; fileName: string; version: string; demoVideoKey?: string; coverKey?: string };
export type PluginUploadSignatureParams = { kind: "video" | "cover"; fileName: string };
export type PluginUploadSignature = { uploadUrl: string; fileKey: string; contentType: string };

export type Sponsor = { id: number; name: string; logoUrl: string; readme: string };
export type HomeAdvertisement = {
  title: string;
  content: string;
  imageUrl: string;
  buttonText: string;
  actionType: "web" | "path" | "settings";
  actionTarget: string;
  endsAt: number | null;
  updatedAt: number;
  appearance?: {
    mode: "text" | "image";
    backgroundColor: string;
    backgroundEndColor?: string;
    textColor: string;
    buttonColor: string;
    buttonTextColor: string;
  };
};
export type HomeAdvertisements = {
  banner: HomeAdvertisement | null;
  banners: HomeAdvertisement[];
  bannerMode: "carousel" | "stack";
  bannerInterval: number;
  sidebar: HomeAdvertisement[];
};
export type ExploreCategory = { id: string; name: string };
export type ExploreProject = {
  id: string;
  title: string;
  coverUrl: string;
  author: { id: string; name: string; avatarUrl?: string };
  likeCount: number;
  collectionCount: number;
};
export type ExploreParams = { cursor?: string; limit: number; categoryId?: string; searchKeyword?: string };
export type ExplorePage = { source?: "repository"; categories: ExploreCategory[]; list: ExploreProject[]; nextCursor: string | null };
export type ExploreDetail = ExploreProject & { description: string; videoUrl: string; shareUrl: string };
export type ExploreUploadSignatureParams = { kind: "cover" | "video" | "download"; fileName: string };
export type ExploreUploadSignature = { uploadUrl: string; fileKey: string; contentType: string };
export type UploadExploreProjectParams = { title: string; description?: string; coverKey: string; videoKey: string; downloadKey?: string };
export type ExploreSubmission = { id: number; state: 0 };
export type ExploreProcess = {
  canvases: {
    id: string;
    name: string;
    nodes: {
      id: string;
      label: string;
      position: { x: number; y: number };
      width?: number;
      height?: number;
      parentNode?: string;
      kind?: "group";
      handles?: { id: string; type: "source" | "target"; dataType: string | string[]; label?: string }[];
      text?: string;
      prompt?: string;
      media?: { type: "image" | "video" | "audio"; url: string };
    }[];
    edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }[];
  }[];
};

export interface Channel {
  getPlugins(params: PluginsParams, options: AuthenticatedOptions): Promise<{ list: Plugin[]; total: number }>;
  getPluginExistence(plugins: PluginIdentity[], options: AuthenticatedOptions): Promise<PluginExistence[]>;
  toggleCollection(pluginId: number, options: AuthenticatedOptions): Promise<{ collected: boolean }>;
  getPluginUploadSignature(params: PluginUploadSignatureParams, options: AuthenticatedOptions): Promise<PluginUploadSignature>;
  uploadPlugin(params: UploadPluginParams, options: AuthenticatedOptions): Promise<string>;
  updatePlugin(params: UpdatePluginParams, options: AuthenticatedOptions): Promise<string>;
  deletePlugin(id: number, options: AuthenticatedOptions): Promise<string>;
  getExploreProjects(params: ExploreParams, options?: RequestOptions): Promise<ExplorePage>;
  getExploreProject(projectId: string, options?: RequestOptions): Promise<ExploreDetail>;
  getExploreProcess(projectId: string, options?: RequestOptions): Promise<ExploreProcess>;
  getExploreDownload(projectId: string, options?: RequestOptions): Promise<{ downloadUrl: string }>;
  getExploreUploadSignature(params: ExploreUploadSignatureParams, options: AuthenticatedOptions): Promise<ExploreUploadSignature>;
  uploadExploreProject(params: UploadExploreProjectParams, options: AuthenticatedOptions): Promise<ExploreSubmission>;
  getSponsorList(options?: RequestOptions): Promise<Sponsor[]>;
  getAdvertisements(options?: RequestOptions): Promise<HomeAdvertisements>;
}
