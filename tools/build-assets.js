/*
 * build-assets.js  —  从官方 1.16.5 资源包生成网页版所需的数据
 *
 * 用法:  node tools/build-assets.js
 * 输出:  assets/generated/blocks.js   (方块表 / 模型 / 贴图索引 / 语言)
 *
 * 它会真实解析 assets/minecraft/blockstates 与 models/block，
 * 处理 parent 继承、textures 变量引用、multipart、变体旋转，
 * 因此方块外观与 1.16.5 原版一致。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const MC = path.join(ROOT, 'assets', 'minecraft');
const MODELS = path.join(MC, 'models');
const BLOCKSTATES = path.join(MC, 'blockstates');
const TEXDIR = path.join(MC, 'textures');
const OUT = path.join(ROOT, 'assets', 'generated', 'blocks.js');

/* ------------------------------------------------------------------ *
 *  方块清单  (id -> 元数据)
 *  render : opaque | cutout | translucent
 *  kind   : cube | axis | facing | stairs | slab | plant | none
 *  opacity: 光照衰减 (255 = 不透光)
 * ------------------------------------------------------------------ */
const B = (o) => o;
const LIST = {
  /* ---- 自然 ---- */
  stone: B({ kind: 'cube', hardness: 1.5 }),
  granite: B({ kind: 'cube', hardness: 1.5 }),
  polished_granite: B({ kind: 'cube', hardness: 1.5 }),
  diorite: B({ kind: 'cube', hardness: 1.5 }),
  polished_diorite: B({ kind: 'cube', hardness: 1.5 }),
  andesite: B({ kind: 'cube', hardness: 1.5 }),
  polished_andesite: B({ kind: 'cube', hardness: 1.5 }),
  grass_block: B({ kind: 'cube', hardness: 0.6, tint: 'grass' }),
  dirt: B({ kind: 'cube', hardness: 0.5 }),
  coarse_dirt: B({ kind: 'cube', hardness: 0.5 }),
  podzol: B({ kind: 'cube', hardness: 0.5 }),
  farmland: B({ kind: 'cube', hardness: 0.6 }),
  grass_path: B({ kind: 'cube', hardness: 0.65 }),
  cobblestone: B({ kind: 'cube', hardness: 2 }),
  mossy_cobblestone: B({ kind: 'cube', hardness: 2 }),
  bedrock: B({ kind: 'cube', hardness: -1 }),
  sand: B({ kind: 'cube', hardness: 0.5 }),
  red_sand: B({ kind: 'cube', hardness: 0.5 }),
  sandstone: B({ kind: 'cube', hardness: 0.8 }),
  chiseled_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  cut_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  smooth_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  red_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  chiseled_red_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  cut_red_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  smooth_red_sandstone: B({ kind: 'cube', hardness: 0.8 }),
  gravel: B({ kind: 'cube', hardness: 0.6 }),
  clay: B({ kind: 'cube', hardness: 0.6 }),
  terracotta: B({ kind: 'cube', hardness: 1.25 }),
  snow_block: B({ kind: 'cube', hardness: 0.2 }),
  snow: B({ kind: 'slab', hardness: 0.1 }),
  ice: B({ kind: 'cube', render: 'translucent', hardness: 0.5 }),
  packed_ice: B({ kind: 'cube', hardness: 0.5 }),
  blue_ice: B({ kind: 'cube', hardness: 2.8 }),
  obsidian: B({ kind: 'cube', hardness: 50 }),
  crying_obsidian: B({ kind: 'cube', hardness: 50 }),
  mycelium: B({ kind: 'cube', hardness: 0.6 }),
  end_stone: B({ kind: 'cube', hardness: 3 }),
  sponge: B({ kind: 'cube', hardness: 0.6 }),
  wet_sponge: B({ kind: 'cube', hardness: 0.6 }),
  magma_block: B({ kind: 'cube', hardness: 0.5, light: 3 }),
  soul_sand: B({ kind: 'cube', hardness: 0.5 }),
  soul_soil: B({ kind: 'cube', hardness: 0.5 }),
  netherrack: B({ kind: 'cube', hardness: 0.4 }),
  nether_bricks: B({ kind: 'cube', hardness: 2 }),
  red_nether_bricks: B({ kind: 'cube', hardness: 2 }),
  chiseled_nether_bricks: B({ kind: 'cube', hardness: 2 }),
  cracked_nether_bricks: B({ kind: 'cube', hardness: 2 }),
  nether_wart_block: B({ kind: 'cube', hardness: 1 }),
  warped_wart_block: B({ kind: 'cube', hardness: 1 }),
  shroomlight: B({ kind: 'cube', hardness: 1, light: 15 }),
  crimson_nylium: B({ kind: 'cube', hardness: 0.4 }),
  warped_nylium: B({ kind: 'cube', hardness: 0.4 }),
  crimson_stem: B({ kind: 'axis', hardness: 2 }),
  warped_stem: B({ kind: 'axis', hardness: 2 }),
  crimson_planks: B({ kind: 'cube', hardness: 2 }),
  warped_planks: B({ kind: 'cube', hardness: 2 }),
  blackstone: B({ kind: 'cube', hardness: 1.5 }),
  polished_blackstone: B({ kind: 'cube', hardness: 1.5 }),
  polished_blackstone_bricks: B({ kind: 'cube', hardness: 1.5 }),
  chiseled_polished_blackstone: B({ kind: 'cube', hardness: 1.5 }),
  cracked_polished_blackstone_bricks: B({ kind: 'cube', hardness: 1.5 }),
  gilded_blackstone: B({ kind: 'cube', hardness: 1.5 }),
  basalt: B({ kind: 'axis', hardness: 1.25 }),
  polished_basalt: B({ kind: 'axis', hardness: 1.25 }),
  ancient_debris: B({ kind: 'cube', hardness: 30 }),
  /* ---- 矿石 / 矿物块 ---- */
  coal_ore: B({ kind: 'cube', hardness: 3 }),
  iron_ore: B({ kind: 'cube', hardness: 3 }),
  gold_ore: B({ kind: 'cube', hardness: 3 }),
  diamond_ore: B({ kind: 'cube', hardness: 3 }),
  emerald_ore: B({ kind: 'cube', hardness: 3 }),
  lapis_ore: B({ kind: 'cube', hardness: 3 }),
  redstone_ore: B({ kind: 'cube', hardness: 3 }),
  nether_gold_ore: B({ kind: 'cube', hardness: 3 }),
  nether_quartz_ore: B({ kind: 'cube', hardness: 3 }),
  coal_block: B({ kind: 'cube', hardness: 5 }),
  iron_block: B({ kind: 'cube', hardness: 5 }),
  gold_block: B({ kind: 'cube', hardness: 3 }),
  diamond_block: B({ kind: 'cube', hardness: 5 }),
  emerald_block: B({ kind: 'cube', hardness: 5 }),
  lapis_block: B({ kind: 'cube', hardness: 3 }),
  redstone_block: B({ kind: 'cube', hardness: 5 }),
  netherite_block: B({ kind: 'cube', hardness: 50 }),
  quartz_block: B({ kind: 'cube', hardness: 0.8 }),
  chiseled_quartz_block: B({ kind: 'cube', hardness: 0.8 }),
  quartz_pillar: B({ kind: 'axis', hardness: 0.8 }),
  smooth_quartz: B({ kind: 'cube', hardness: 0.8 }),
  quartz_bricks: B({ kind: 'cube', hardness: 0.8 }),
  purpur_block: B({ kind: 'cube', hardness: 1.5 }),
  purpur_pillar: B({ kind: 'axis', hardness: 1.5 }),
  bone_block: B({ kind: 'axis', hardness: 2 }),
  hay_block: B({ kind: 'axis', hardness: 0.5 }),
  /* ---- 建材 ---- */
  oak_planks: B({ kind: 'cube', hardness: 2 }),
  spruce_planks: B({ kind: 'cube', hardness: 2 }),
  birch_planks: B({ kind: 'cube', hardness: 2 }),
  jungle_planks: B({ kind: 'cube', hardness: 2 }),
  acacia_planks: B({ kind: 'cube', hardness: 2 }),
  dark_oak_planks: B({ kind: 'cube', hardness: 2 }),
  oak_log: B({ kind: 'axis', hardness: 2 }),
  spruce_log: B({ kind: 'axis', hardness: 2 }),
  birch_log: B({ kind: 'axis', hardness: 2 }),
  jungle_log: B({ kind: 'axis', hardness: 2 }),
  acacia_log: B({ kind: 'axis', hardness: 2 }),
  dark_oak_log: B({ kind: 'axis', hardness: 2 }),
  stripped_oak_log: B({ kind: 'axis', hardness: 2 }),
  stripped_spruce_log: B({ kind: 'axis', hardness: 2 }),
  stripped_birch_log: B({ kind: 'axis', hardness: 2 }),
  stripped_jungle_log: B({ kind: 'axis', hardness: 2 }),
  stripped_acacia_log: B({ kind: 'axis', hardness: 2 }),
  stripped_dark_oak_log: B({ kind: 'axis', hardness: 2 }),
  oak_leaves: B({ kind: 'cube', render: 'cutout', opacity: 1, tint: 'foliage', hardness: 0.2 }),
  spruce_leaves: B({ kind: 'cube', render: 'cutout', opacity: 1, tint: 'foliage', hardness: 0.2 }),
  birch_leaves: B({ kind: 'cube', render: 'cutout', opacity: 1, tint: 'foliage', hardness: 0.2 }),
  jungle_leaves: B({ kind: 'cube', render: 'cutout', opacity: 1, tint: 'foliage', hardness: 0.2 }),
  acacia_leaves: B({ kind: 'cube', render: 'cutout', opacity: 1, tint: 'foliage', hardness: 0.2 }),
  dark_oak_leaves: B({ kind: 'cube', render: 'cutout', opacity: 1, tint: 'foliage', hardness: 0.2 }),
  glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  glass_pane: B({ kind: 'none', render: 'cutout', opacity: 0, hardness: 0.3, forceState: { north: 'true', south: 'true', east: 'true', west: 'true' } }),
  white_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  orange_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  yellow_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  lime_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  light_blue_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  cyan_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  blue_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  purple_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  magenta_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  pink_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  red_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  brown_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  green_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  black_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  gray_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  light_gray_stained_glass: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.3 }),
  bricks: B({ kind: 'cube', hardness: 2 }),
  stone_bricks: B({ kind: 'cube', hardness: 1.5 }),
  mossy_stone_bricks: B({ kind: 'cube', hardness: 1.5 }),
  cracked_stone_bricks: B({ kind: 'cube', hardness: 1.5 }),
  chiseled_stone_bricks: B({ kind: 'cube', hardness: 1.5 }),
  smooth_stone: B({ kind: 'cube', hardness: 2 }),
  smooth_stone_slab: B({ kind: 'slab', hardness: 2 }),
  stone_brick_stairs: B({ kind: 'stairs', hardness: 1.5 }),
  mossy_stone_brick_stairs: B({ kind: 'stairs', hardness: 1.5 }),
  oak_stairs: B({ kind: 'stairs', hardness: 2 }),
  spruce_stairs: B({ kind: 'stairs', hardness: 2 }),
  stone_stairs: B({ kind: 'stairs', hardness: 1.5 }),
  cobblestone_stairs: B({ kind: 'stairs', hardness: 2 }),
  sandstone_stairs: B({ kind: 'stairs', hardness: 0.8 }),
  brick_stairs: B({ kind: 'stairs', hardness: 2 }),
  quartz_stairs: B({ kind: 'stairs', hardness: 0.8 }),
  purpur_stairs: B({ kind: 'stairs', hardness: 1.5 }),
  nether_brick_stairs: B({ kind: 'stairs', hardness: 2 }),
  oak_slab: B({ kind: 'slab', hardness: 2 }),
  spruce_slab: B({ kind: 'slab', hardness: 2 }),
  stone_slab: B({ kind: 'slab', hardness: 1.5 }),
  cobblestone_slab: B({ kind: 'slab', hardness: 2 }),
  sandstone_slab: B({ kind: 'slab', hardness: 0.8 }),
  brick_slab: B({ kind: 'slab', hardness: 2 }),
  quartz_slab: B({ kind: 'slab', hardness: 0.8 }),
  purpur_slab: B({ kind: 'slab', hardness: 1.5 }),
  nether_brick_slab: B({ kind: 'slab', hardness: 2 }),
  oak_fence: B({ kind: 'none', hardness: 2 }),
  spruce_fence: B({ kind: 'none', hardness: 2 }),
  birch_fence: B({ kind: 'none', hardness: 2 }),
  nether_brick_fence: B({ kind: 'none', hardness: 2 }),
  cobblestone_wall: B({ kind: 'none', hardness: 2 }),
  iron_bars: B({ kind: 'none', render: 'cutout', opacity: 0, hardness: 5, forceState: { north: 'true', south: 'true', east: 'true', west: 'true' } }),
  ladder: B({ kind: 'facing', render: 'cutout', opacity: 0, hardness: 0.4 }),
  oak_door: B({ kind: 'none', render: 'cutout', opacity: 0, hardness: 3, forceState: { facing: 'north', half: 'lower', hinge: 'left', open: 'false', powered: 'false' } }),
  oak_trapdoor: B({ kind: 'none', render: 'cutout', opacity: 0, hardness: 3, forceState: { facing: 'north', half: 'bottom', open: 'false', powered: 'false', waterlogged: 'false' } }),
  oak_fence_gate: B({ kind: 'none', hardness: 2 }),
  /* ---- 功能方块 ---- */
  crafting_table: B({ kind: 'cube', hardness: 2.5 }),
  furnace: B({ kind: 'facing', hardness: 3.5 }),
  blast_furnace: B({ kind: 'facing', hardness: 3.5 }),
  smoker: B({ kind: 'facing', hardness: 3.5 }),
  barrel: B({ kind: 'facing', hardness: 2.5 }),
  bookshelf: B({ kind: 'cube', hardness: 1.5 }),
  note_block: B({ kind: 'cube', hardness: 0.8 }),
  jukebox: B({ kind: 'cube', hardness: 2 }),
  tnt: B({ kind: 'cube', hardness: 0 }),
  dispenser: B({ kind: 'facing', hardness: 3.5 }),
  dropper: B({ kind: 'facing', hardness: 3.5 }),
  observer: B({ kind: 'facing', hardness: 3 }),
  piston: B({ kind: 'facing', hardness: 1.5 }),
  sticky_piston: B({ kind: 'facing', hardness: 1.5 }),
  target: B({ kind: 'cube', hardness: 0.5 }),
  beacon: B({ kind: 'cube', render: 'cutout', opacity: 0, light: 15, hardness: 3 }),
  dragon_egg: B({ kind: 'cube', hardness: 3 }),
  respawn_anchor: B({ kind: 'cube', hardness: 50 }),
  lodestone: B({ kind: 'cube', hardness: 3.5 }),
  anvil: B({ kind: 'facing', hardness: 5 }),
  cauldron: B({ kind: 'none', render: 'cutout', hardness: 2 }),
  brewing_stand: B({ kind: 'none', render: 'cutout', opacity: 0, light: 1, hardness: 0.5 }),
  enchanting_table: B({ kind: 'none', render: 'cutout', light: 7, hardness: 5 }),
  end_portal_frame: B({ kind: 'facing', hardness: -1 }),
  spawner: B({ kind: 'cube', render: 'cutout', opacity: 0, hardness: 5 }),
  stonecutter: B({ kind: 'facing', hardness: 3.5 }),
  grindstone: B({ kind: 'facing', hardness: 2 }),
  lectern: B({ kind: 'facing', hardness: 2.5 }),
  loom: B({ kind: 'facing', hardness: 2.5 }),
  cartography_table: B({ kind: 'cube', hardness: 2.5 }),
  fletching_table: B({ kind: 'cube', hardness: 2.5 }),
  smithing_table: B({ kind: 'cube', hardness: 2.5 }),
  composter: B({ kind: 'cube', hardness: 0.6 }),
  bell: B({ kind: 'none', render: 'cutout', opacity: 0, hardness: 5 }),
  bee_nest: B({ kind: 'facing', hardness: 0.3 }),
  honeycomb_block: B({ kind: 'cube', hardness: 0.6 }),
  honey_block: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.6 }),
  slime_block: B({ kind: 'cube', render: 'translucent', opacity: 0, hardness: 0.6 }),
  scaffolding: B({ kind: 'none', render: 'cutout', opacity: 0, hardness: 0 }),
  /* ---- 光照 ---- */
  torch: B({ kind: 'none', render: 'cutout', opacity: 0, light: 14, hardness: 0, solid: false }),
  wall_torch: B({ kind: 'facing', render: 'cutout', opacity: 0, light: 14, hardness: 0, solid: false }),
  soul_torch: B({ kind: 'none', render: 'cutout', opacity: 0, light: 10, hardness: 0, solid: false }),
  soul_wall_torch: B({ kind: 'facing', render: 'cutout', opacity: 0, light: 10, hardness: 0, solid: false }),
  lantern: B({ kind: 'none', render: 'cutout', opacity: 0, light: 15, hardness: 3.5 }),
  soul_lantern: B({ kind: 'none', render: 'cutout', opacity: 0, light: 10, hardness: 3.5 }),
  redstone_torch: B({ kind: 'none', render: 'cutout', opacity: 0, light: 7, hardness: 0, solid: false }),
  glowstone: B({ kind: 'cube', light: 15, hardness: 0.3 }),
  sea_lantern: B({ kind: 'cube', light: 15, hardness: 0.3 }),
  jack_o_lantern: B({ kind: 'facing', light: 15, hardness: 1 }),
  campfire: B({ kind: 'facing', render: 'cutout', opacity: 0, light: 15, hardness: 2 }),
  soul_campfire: B({ kind: 'facing', render: 'cutout', opacity: 0, light: 10, hardness: 2 }),
  redstone_lamp: B({ kind: 'cube', hardness: 0.3 }),
  chain: B({ kind: 'axis', render: 'cutout', opacity: 0, hardness: 5 }),
  end_rod: B({ kind: 'none', render: 'cutout', opacity: 0, light: 14, hardness: 0, solid: false }),
  /* ---- 液体 ---- */
  water: B({ kind: 'cube', render: 'translucent', opacity: 1, liquid: true, solid: false, hardness: 100, custom: 'water' }),
  lava: B({ kind: 'cube', render: 'opaque', liquid: true, solid: false, light: 15, hardness: 100, custom: 'lava' }),
  /* ---- 植物 ---- */
  grass: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0, tint: 'grass' }),
  fern: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0, tint: 'grass' }),
  tall_grass: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0, tint: 'grass', lang: 'grass' }),
  dead_bush: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  dandelion: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  poppy: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  blue_orchid: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  allium: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  azure_bluet: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  red_tulip: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  orange_tulip: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  white_tulip: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  pink_tulip: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  oxeye_daisy: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  cornflower: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  lily_of_the_valley: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  sunflower: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  lilac: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  rose_bush: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  peony: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  brown_mushroom: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  red_mushroom: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  brown_mushroom_block: B({ kind: 'cube', hardness: 0.2 }),
  red_mushroom_block: B({ kind: 'cube', hardness: 0.2 }),
  mushroom_stem: B({ kind: 'cube', hardness: 0.2 }),
  sugar_cane: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0, tint: 'grass' }),
  cactus: B({ kind: 'none', render: 'cutout', hardness: 0.4 }),
  bamboo: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 1 }),
  pumpkin: B({ kind: 'axis', hardness: 1 }),
  carved_pumpkin: B({ kind: 'facing', hardness: 1 }),
  melon: B({ kind: 'cube', hardness: 1 }),
  cobweb: B({ kind: 'cube', render: 'cutout', opacity: 0, solid: false, hardness: 4 }),
  vine: B({ kind: 'none', render: 'cutout', opacity: 0, solid: false, hardness: 0.2, tint: 'foliage', forceState: { north: 'true', south: 'true', east: 'true', west: 'true', up: 'true' } }),
  lily_pad: B({ kind: 'none', render: 'cutout', opacity: 0, solid: false, hardness: 0, tint: 'foliage' }),
  seagrass: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  kelp: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  oak_sapling: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  spruce_sapling: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  birch_sapling: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  jungle_sapling: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  acacia_sapling: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  dark_oak_sapling: B({ kind: 'plant', render: 'cutout', opacity: 0, solid: false, hardness: 0 }),
  /* ---- 羊毛 / 混凝土 ---- */
  white_wool: B({ kind: 'cube', hardness: 0.8 }),
  orange_wool: B({ kind: 'cube', hardness: 0.8 }),
  yellow_wool: B({ kind: 'cube', hardness: 0.8 }),
  lime_wool: B({ kind: 'cube', hardness: 0.8 }),
  green_wool: B({ kind: 'cube', hardness: 0.8 }),
  cyan_wool: B({ kind: 'cube', hardness: 0.8 }),
  light_blue_wool: B({ kind: 'cube', hardness: 0.8 }),
  blue_wool: B({ kind: 'cube', hardness: 0.8 }),
  purple_wool: B({ kind: 'cube', hardness: 0.8 }),
  magenta_wool: B({ kind: 'cube', hardness: 0.8 }),
  pink_wool: B({ kind: 'cube', hardness: 0.8 }),
  brown_wool: B({ kind: 'cube', hardness: 0.8 }),
  red_wool: B({ kind: 'cube', hardness: 0.8 }),
  black_wool: B({ kind: 'cube', hardness: 0.8 }),
  gray_wool: B({ kind: 'cube', hardness: 0.8 }),
  light_gray_wool: B({ kind: 'cube', hardness: 0.8 }),
  white_concrete: B({ kind: 'cube', hardness: 1.8 }),
  red_concrete: B({ kind: 'cube', hardness: 1.8 }),
  blue_concrete: B({ kind: 'cube', hardness: 1.8 }),
  green_concrete: B({ kind: 'cube', hardness: 1.8 }),
  yellow_concrete: B({ kind: 'cube', hardness: 1.8 }),
  black_concrete: B({ kind: 'cube', hardness: 1.8 }),
  orange_concrete: B({ kind: 'cube', hardness: 1.8 }),
  light_blue_concrete: B({ kind: 'cube', hardness: 1.8 }),
  lime_concrete: B({ kind: 'cube', hardness: 1.8 }),
  cyan_concrete: B({ kind: 'cube', hardness: 1.8 }),
  purple_concrete: B({ kind: 'cube', hardness: 1.8 }),
  magenta_concrete: B({ kind: 'cube', hardness: 1.8 }),
  pink_concrete: B({ kind: 'cube', hardness: 1.8 }),
  brown_concrete: B({ kind: 'cube', hardness: 1.8 }),
  gray_concrete: B({ kind: 'cube', hardness: 1.8 }),
  light_gray_concrete: B({ kind: 'cube', hardness: 1.8 }),
};

/* ------------------------------------------------------------------ *
 *  PNG 解码 (只支持非交错 8bit RGB/RGBA，足够读取资源包)
 * ------------------------------------------------------------------ */
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = Buffer.from(raw.slice(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = (y * w + x) * 4;
      out[d] = line[s];
      out[d + 1] = ch >= 3 ? line[s + 1] : line[s];
      out[d + 2] = ch >= 3 ? line[s + 2] : line[s];
      out[d + 3] = ch === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { w, h, data: out };
}

function pngInfo(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

/* ------------------------------------------------------------------ *
 *  模型解析
 * ------------------------------------------------------------------ */
const stripNs = (s) => (s.indexOf(':') >= 0 ? s.slice(s.indexOf(':') + 1) : s);
const modelCache = new Map();

function readJSON(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function resolveTextureRef(ref, texMap, depth) {
  if (ref == null) return null;
  depth = depth || 0;
  if (depth > 16) return null;
  ref = String(ref);
  if (ref[0] === '#') {
    const key = ref.slice(1);
    if (!(key in texMap)) return null;
    return resolveTextureRef(texMap[key], texMap, depth + 1);
  }
  return stripNs(ref);
}

function resolveModel(name) {
  name = stripNs(name);
  if (modelCache.has(name)) return modelCache.get(name);
  const file = path.join(MODELS, name + '.json');
  let json = null;
  try { json = readJSON(file); } catch (e) { return null; }
  const parentName = json.parent ? stripNs(json.parent) : null;
  const parent = parentName ? resolveModel(parentName) : null;

  const texMap = Object.assign({}, parent ? parent.textures : null, json.textures);
  let ao = json.ambientocclusion != null ? json.ambientocclusion : (parent ? parent.ao : true);

  const rawElements = json.elements || (parent ? parent.rawElements : null);
  const outEls = resolveElements(rawElements, texMap);
  const res = { name, textures: texMap, elements: outEls, rawElements, ao };
  modelCache.set(name, res);
  return res;
}

function resolveElements(elements, texMap) {
  const outEls = [];
  if (elements) {
    for (const el of elements) {
      const ne = {
        from: el.from, to: el.to,
        rotation: el.rotation || null,
        shade: el.shade !== false,
        faces: {},
      };
      for (const fname of ['down', 'up', 'north', 'south', 'west', 'east']) {
        const f = el.faces && el.faces[fname];
        if (!f) continue;
        const tex = resolveTextureRef(f.texture, texMap);
        if (!tex) continue;
        ne.faces[fname] = {
          uv: f.uv || [0, 0, 16, 16],
          tex,
          cull: f.cullface || null,
          tint: f.tintindex != null ? f.tintindex : -1,
          rot: f.rotation || 0,
        };
      }
      if (Object.keys(ne.faces).length) outEls.push(ne);
    }
  }
  return outEls;
}

/* ------------------------------------------------------------------ *
 *  blockstate -> 变体列表
 * ------------------------------------------------------------------ */
function parseKey(key) {
  const props = {};
  if (!key) return props;
  for (const part of key.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) props[part.slice(0, i)] = part.slice(i + 1);
  }
  return props;
}
function stateString(props) {
  return Object.keys(props).sort().map(k => k + '=' + props[k]).join(',');
}
function matchWhen(when, state) {
  if (!when) return true;
  if (Array.isArray(when)) return when.some(w => matchWhen(w, state));
  for (const k in when) {
    const want = when[k];
    const have = state[k];
    if (have == null) return false;
    if (String(want).split('|').indexOf(String(have)) < 0) return false;
  }
  return true;
}

function variantPref(props) {
  let score = 0;
  const s = (k, v) => String(props[k]) === v;
  if (s('shape', 'straight')) score += 100;
  if (s('half', 'bottom')) score += 50;
  if (s('type', 'bottom')) score += 50;
  if (s('axis', 'y')) score += 50;
  if (s('facing', 'north')) score += 40;
  if (s('lit', 'false')) score += 6;
  if (s('open', 'false')) score += 5;
  if (s('hanging', 'false')) score += 5;
  if (s('snowy', 'false')) score += 3;
  if (s('up', 'false')) score += 2;
  if (s('north', 'false')) score += 1;
  return score;
}

function buildVariants(id, meta) {
  const file = path.join(BLOCKSTATES, id + '.json');
  let bs;
  try { bs = readJSON(file); } catch (e) { return null; }
  const variants = [];
  const seen = new Set();

  if (bs.variants) {
    for (const key in bs.variants) {
      let v = bs.variants[key];
      if (Array.isArray(v)) v = v[0];
      if (!v || typeof v.model !== 'string' || !v.model) continue;
      const props = parseKey(key);
      const st = stateString(props);
      if (seen.has(st)) continue;
      seen.add(st);
      variants.push({ props, state: st, model: stripNs(v.model), rot: [v.x || 0, v.y || 0, v.z || 0], uvlock: !!v.uvlock });
    }
  } else if (bs.multipart) {
    // 取"规范状态"：所有布尔属性 false，其它取第一个值
    const canonical = {};
    const allProps = {};
    for (const part of bs.multipart) {
      const whens = Array.isArray(part.when) ? part.when : (part.when ? [part.when] : []);
      for (const w of whens) for (const k in w) {
        (allProps[k] = allProps[k] || new Set());
        for (const v of String(w[k]).split('|')) allProps[k].add(v);
      }
    }
    for (const k in allProps) {
      const vals = [...allProps[k]];
      canonical[k] = vals.indexOf('false') >= 0 ? 'false' : vals[0];
    }
    if (meta.forceState) for (const k in meta.forceState) canonical[k] = meta.forceState[k];
    const apply = bs.multipart.filter(part => matchWhen(part.when, canonical));
    for (const part of apply) {
      const v = part.apply;
      if (!v || typeof v.model !== 'string' || !v.model) continue;
      variants.push({ props: canonical, state: stateString(canonical), model: stripNs(v.model), rot: [v.x || 0, v.y || 0, v.z || 0], uvlock: !!v.uvlock });
    }
  }
  return variants;
}

/* ------------------------------------------------------------------ *
 *  主流程
 * ------------------------------------------------------------------ */
function customElements(kind) {
  const mk = (from, to, tex) => {
    const faces = {};
    for (const f of ['down', 'up', 'north', 'south', 'west', 'east']) {
      faces[f] = { uv: [0, 0, 16, 16], tex, cull: f, tint: -1, rot: 0 };
    }
    return { from, to, rotation: null, shade: true, faces };
  };
  if (kind === 'water') return [mk([0, 0, 0], [16, 14, 16], 'block/water_still')];
  if (kind === 'lava') return [mk([0, 0, 0], [16, 16, 16], 'block/lava_still')];
  return [];
}

const blocks = [];
const texSet = new Set();
const usedModels = new Set();
const missing = [];
const warnings = [];
let typeId = 1;

for (const id in LIST) {
  const meta = LIST[id];
  const langKey = meta.lang || id;
  const bsFile = path.join(BLOCKSTATES, id + '.json');
  if (!fs.existsSync(bsFile)) { missing.push(id + ' (无 blockstate)'); continue; }
  const variants = buildVariants(id, meta);
  if (!variants || !variants.length) { missing.push(id + ' (无变体)'); continue; }

  const outVars = [];
  if (meta.custom) {
    const mname = '__custom/' + meta.custom;
    if (!modelCache.has(mname)) modelCache.set(mname, { name: mname, textures: {}, elements: customElements(meta.custom), ao: true });
    const cm = modelCache.get(mname);
    cm.elements.forEach(el => { for (const f in el.faces) texSet.add(el.faces[f].tex); });
    usedModels.add(mname);
    outVars.push({ state: '', props: {}, model: mname, rot: [0, 0, 0], ao: true });
  }
  for (const v of (meta.custom ? [] : variants)) {
    const m = resolveModel(v.model);
    if (!m || !m.elements.length) { warnings.push(id + ' -> ' + v.model + ' 无几何'); continue; }
    usedModels.add(m.name);
    for (const el of m.elements) for (const f in el.faces) texSet.add(el.faces[f].tex);
    outVars.push({ state: v.state, props: v.props, model: m.name, rot: v.rot, ao: m.ao !== false });
  }
  if (!outVars.length) { missing.push(id + ' (无几何)'); continue; }

  /* 规范变体（用于碰撞盒 / 图标） */
  let pref = 0, prefScore = -1;
  outVars.forEach((v, i) => {
    const sc = variantPref(v.props);
    if (sc > prefScore) { prefScore = sc; pref = i; }
  });
  const prefModel = modelCache.get(outVars[pref].model);
  const boxes = [];
  let iconTop = null, iconSide = null, iconAll = null, maxVol = -1;
  if (prefModel) {
    for (const el of prefModel.elements) {
      let x0 = Math.min(el.from[0], el.to[0]) / 16, y0 = Math.min(el.from[1], el.to[1]) / 16, z0 = Math.min(el.from[2], el.to[2]) / 16;
      let x1 = Math.max(el.from[0], el.to[0]) / 16, y1 = Math.max(el.from[1], el.to[1]) / 16, z1 = Math.max(el.from[2], el.to[2]) / 16;
      const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
      const vol = ex * ey * ez;
      if (vol > maxVol) {
        maxVol = vol;
        iconTop = el.faces.up ? el.faces.up.tex : null;
        iconSide = el.faces.north ? el.faces.north.tex : (el.faces.east ? el.faces.east.tex : null);
        iconAll = iconSide || iconTop;
      }
      if (meta.solid !== false && ex > 0.12 && ey > 0.12 && ez > 0.12) {
        boxes.push([x0, y0, z0, x1, y1, z1]);
      }
    }
    for (let i = boxes.length - 1; i >= 0; i--) {
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        const a = boxes[i], b = boxes[j];
        if (a[0] >= b[0] - 1e-6 && a[1] >= b[1] - 1e-6 && a[2] >= b[2] - 1e-6 && a[3] <= b[3] + 1e-6 && a[4] <= b[4] + 1e-6 && a[5] <= b[5] + 1e-6) {
          boxes.splice(i, 1); break;
        }
      }
    }
  }

  /* 旋转 -> 变体索引 */
  const findVariant = (changes) => {
    let best = -1, bestSc = -1;
    outVars.forEach((v, i) => {
      for (const k in changes) if (String(v.props[k]) !== String(changes[k])) return;
      let sc = 0;
      for (const k in outVars[pref].props) if (String(v.props[k]) === String(outVars[pref].props[k])) sc++;
      if (sc > bestSc) { bestSc = sc; best = i; }
    });
    return best;
  };
  let rotMap = [pref];
  const kind = meta.kind || 'cube';
  if (kind === 'axis') {
    rotMap = ['y', 'x', 'z', 'y'].map(a => { const i = findVariant({ axis: a }); return i < 0 ? pref : i; });
  } else if (kind === 'facing') {
    rotMap = ['north', 'east', 'south', 'west'].map(f => { const i = findVariant({ facing: f }); return i < 0 ? pref : i; });
  } else if (kind === 'slab') {
    rotMap = ['bottom', 'top', 'double'].map(t => { const i = findVariant({ type: t }); return i < 0 ? pref : i; });
  } else if (kind === 'stairs') {
    rotMap = [];
    for (const half of ['bottom', 'top']) {
      for (const f of ['north', 'east', 'south', 'west']) {
        const i = findVariant({ facing: f, half, shape: 'straight' });
        rotMap.push(i < 0 ? pref : i);
      }
    }
  }

  blocks.push({
    id,
    type: typeId++,
    lang: 'block.minecraft.' + langKey,
    kind: meta.kind || 'cube',
    render: meta.render || 'opaque',
    solid: meta.solid !== false,
    opacity: meta.opacity != null ? meta.opacity : (meta.render === 'opaque' || !meta.render ? 255 : 0),
    light: meta.light || 0,
    tint: meta.tint || null,
    liquid: !!meta.liquid,
    hardness: meta.hardness != null ? meta.hardness : 1,
    boxes: boxes.length ? boxes.map(b => b.map(v => Math.round(v * 1000) / 1000)) : (meta.solid === false ? [] : [[0, 0, 0, 1, 1, 1]]),
    iconTop, iconSide, iconAll,
    rotMap,
    variants: outVars,
    vmap: (() => { const o = {}; outVars.forEach((v, i) => { o[v.state] = i; }); return o; })(),
  });
}

/* 额外需要的贴图 (破坏进度等) */
for (let i = 0; i <= 9; i++) texSet.add('block/destroy_stage_' + i);
texSet.add('block/water_overlay');
texSet.add('block/water_flow');

/* 贴图层索引 */
const texList = [...texSet].sort();
const texIndex = {};
texList.forEach((t, i) => { texIndex[t] = i; });

/* 检查贴图是否存在 + 尺寸 */
const texMeta = {};
for (const t of texList) {
  const f = path.join(TEXDIR, t + '.png');
  if (!fs.existsSync(f)) { missing.push('贴图 ' + t); continue; }
  const info = pngInfo(f);
  let frames = 1;
  const mcmeta = f + '.mcmeta';
  if (fs.existsSync(mcmeta)) {
    try {
      const mm = readJSON(mcmeta);
      if (mm.animation && mm.animation.frames) frames = mm.animation.frames.length;
      else if (mm.animation) frames = Math.max(1, Math.round(info.h / info.w));
    } catch (e) { }
  }
  if (info.h > info.w) frames = Math.max(frames, Math.round(info.h / info.w));
  texMeta[t] = { w: info.w, h: info.h, frames };
}

/* 输出模型（只保留用到的） */
const modelsOut = {};
for (const name of usedModels) {
  const m = modelCache.get(name);
  if (!m) continue;
  modelsOut[name] = {
    ao: m.ao !== false,
    elements: m.elements.map(el => ({
      from: el.from, to: el.to,
      rotation: el.rotation,
      shade: el.shade,
      faces: el.faces,
    })),
  };
}

/* 语言 */
const langRaw = JSON.parse(fs.readFileSync(path.join(MC, 'lang', 'en_us.json'), 'utf8'));
const lang = {};
for (const b of blocks) if (langRaw[b.lang]) lang[b.lang] = langRaw[b.lang];
for (const k of Object.keys(langRaw)) {
  if (/^(gui|menu|options|itemGroup|selectWorld|multiplayer|resourcePack|key|narrator|chat|commands|debug|connect|disconnect|soundCategory|mco|tile|container|item\.minecraft|death|advMode|structure_block|advancements|stat)\./.test(k)) lang[k] = langRaw[k];
}

/* 写出 */
const payload = {
  generatedAt: new Date().toISOString(),
  textures: texList,
  texMeta,
  models: modelsOut,
  blocks,
  lang,
};

const js = `/* 自动生成，请勿手动修改。源: tools/build-assets.js */
window.MC_ASSETS = ${JSON.stringify(payload)};
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, js);

/* 统计 */
console.log('方块数      :', blocks.length);
console.log('贴图数      :', texList.length);
console.log('模型数      :', Object.keys(modelsOut).length);
console.log('输出大小    :', (js.length / 1024).toFixed(0) + ' KB');
const kinds = {};
blocks.forEach(b => kinds[b.kind] = (kinds[b.kind] || 0) + 1);
console.log('类型分布    :', JSON.stringify(kinds));
const renders = {};
blocks.forEach(b => renders[b.render] = (renders[b.render] || 0) + 1);
console.log('渲染分布    :', JSON.stringify(renders));
if (warnings.length) console.log('\n警告(' + warnings.length + '):\n  ' + warnings.join('\n  '));
if (missing.length) console.log('\n缺失(' + missing.length + '):\n  ' + missing.join('\n  '));
const big = Object.entries(texMeta).filter(([k, v]) => v.w !== 16 || v.h !== 16);
console.log('\n非16x16贴图 (' + big.length + '):');
big.slice(0, 40).forEach(([k, v]) => console.log('  ' + k + ' ' + v.w + 'x' + v.h + ' frames=' + v.frames));
