// The TinyLap track data model. Cells are [col, row], with rows increasing
// downward like SVG; one cell is one 300 mm Circuit 30 mat.

export type Dir = 'N' | 'E' | 'S' | 'W';
export type Corner = 'NE' | 'SE' | 'SW' | 'NW';
/** Clockwise on screen. layoutFromData refuses anything else. */
export type Rotation = 0 | 90 | 180 | 270;
export type Cell = [number, number];
export type PieceType = 'straight' | 'cornerR30' | 'cornerR60';

export interface Port { cells: Cell[]; dir: Dir }

export interface CapWall { kind: 'cap'; vertex: Cell }
export interface ArcWall { kind: 'arc' | 'arcLarge'; r: number; cell: Cell; corner: Corner }
export type Wall = CapWall | ArcWall;

export interface MatCounts { square?: number; quarterRound?: number; arcLarge?: number }

export interface PieceDef {
  label: string;
  cells: Cell[];
  ports: Port[];
  walls: Wall[];
  mats: MatCounts;
  centrelineMm: number;
}

export interface PlacedPiece { type: PieceType; x: number; y: number; rot: Rotation }
export interface Room { w: number; h: number }

/** The persisted layout, format version 1. */
export interface Layout {
  version: 1;
  unit: 'mat';
  room: Room | null;
  pieces: PlacedPiece[];
}

export interface BBox { x: number; y: number; w: number; h: number }

export interface Metrics {
  bbox: BBox | null;
  matCount: number;
  mats: Record<string, number>;
  lapMm: number;
}

export interface BarrierCounts { straight: number; curve: number; curveLarge: number; cornerCap: number }
export interface Barriers { counts: BarrierCounts; straightEdgeIds: string[]; arcs: ArcWall[] }
