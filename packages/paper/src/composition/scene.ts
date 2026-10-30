import type { CardPresetId, DeepPartial, PaperParams, SheetSpec } from '../index';
import type { CordSpec } from './cords';
import type { PropSpec } from './props';
import type { PhotoSpec, Box } from './photos';
import type { MotionSpec } from './motion-spec';
export interface CardInfo { kind: string; paper: string; fonts: string[]; attachments: string[] }
export type SheetLook = Omit<SheetSpec, 'width' | 'height' | 'pixelRatio'>;

export type Attach = (
  | { type: 'prop'; x: number; y: number; layer: 'front' | 'back'; prop: PropSpec; label: string }
  | {
      type: 'sheet';
      x: number;
      y: number;
      w: number;
      h: number;
      angle: number;
      layer: 'front' | 'back';
      paper: string;
      params?: DeepPartial<PaperParams>;
      look: SheetLook;
      label: string;
    }
  | { type: 'html'; layer: 'front' | 'back'; el: HTMLElement; label?: string }
  /** A string / ribbon; renders its on-top strands in front of the sheet and the tucked-under parts behind. */
  | { type: 'cord'; spec: CordSpec; label: string }
  /** A photo print: a small sheet with a graded photo in its `window` (print px), centred at (cx, cy). */
  | {
      type: 'photo';
      cx: number;
      cy: number;
      w: number;
      h: number;
      angle: number;
      layer: 'front' | 'back';
      paper: string;
      params?: DeepPartial<PaperParams>;
      look: SheetLook;
      photo: PhotoSpec;
      window: Box;
      label: string;
    }
) & {
  /** Only joins two things on the card (a photo taped onto a note): not how the card itself is held. */
  binds?: boolean;
};

export interface CardPlan {
  preset?: CardPresetId;
  w: number;
  h: number;
  rot: number;
  paper: string;
  params?: DeepPartial<PaperParams>;
  look: SheetLook;
  /** Ink, rulings and print, positioned in card-local px. Null for blank paper. */
  ink: HTMLElement | null;
  attach: Attach[];
  info: CardInfo;
  /** How the ink animates once the card is on the desk (motion.ts). */
  motion?: MotionSpec;
}
