/// <reference path="./types.d.ts" />

import deepSeek from "./src/language/deepSeek";

export type Provider = ProviderDefinition;
export type ProviderPrice = NonNullable<Awaited<ReturnType<NonNullable<Provider["getPrice"]>>>>;
export type ProviderPriceRequest = Parameters<NonNullable<Provider["getPrice"]>>[0];
export type ProviderPriceReference = NonNullable<ProviderPriceRequest["images"]>[number];
export type ProviderBalance = Awaited<ReturnType<NonNullable<Provider["getBalance"]>>>;
export type ProviderTools = ProviderContext["tool"];
export type ProviderTaskData = Parameters<NonNullable<ProviderContext["saveTaskData"]>>[0];
export type AudioConvertOptions = Parameters<ProviderTools["audio"]["convert"]>[1];
export type { FfmpegFactory, FfmpegCommand } from "@lum/ffmpeg/types";

export const languageProviders = [deepSeek] as const;

export type EnhancementCapabilities = NonNullable<ProviderModel["enhancementCapabilities"]>;
export type VideoUpscaleRequest = Parameters<NonNullable<Provider["upscaleVideo"]>>[0];
export type VideoUpscalePreparationRequest = Parameters<NonNullable<Provider["prepareVideoUpscale"]>>[0];
export type EnhancementOptions = VideoUpscaleRequest["options"];
export type EnhancementMetadata = VideoUpscaleRequest["source"]["metadata"];
export type EnhancementSource = VideoUpscaleRequest["source"];
export type ProviderEnhancementQuote = VideoUpscaleRequest["preparation"];
