import type { Passage } from "@writer/core";
import type { PassagePlace } from "@writer/editor";
import { create } from "zustand";

/*
 * A passage opened from an entry's profile (#153): the writing view opens its piece and selects the
 * name in it. Asked for here, carried out by the writing view once that piece's text is in its editor.
 */

export interface PassageRequest {
  /** The piece's ID and file (a chapter's editor knows its pieces by file). */
  piece: string;
  file: string;
  place: PassagePlace;
}

export const usePassageRequest = create<{ request: PassageRequest | undefined; /** The pieces the writing view has open. */ showing: readonly string[] }>(() => ({
  request: undefined,
  showing: [],
}));

/**
 * Ask for a passage's sentence to be selected, and say where to go to read it: its piece, or nowhere
 * when the writing view already has it open (a passage chosen beside the text, in its chapter).
 */
export function requestPassage(novelId: string, passage: Passage): string | undefined {
  usePassageRequest.setState({ request: { piece: passage.piece.id, file: passage.piece.file, place: passage.block } });
  return usePassageRequest.getState().showing.includes(passage.piece.id) ? undefined : `/novels/${novelId}/scene/${passage.piece.id}`;
}
