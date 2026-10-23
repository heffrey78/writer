import { useEffect } from "react";
import { useNavigate } from "react-router";

/**
 * Today's entry (#38, #64): the journal page, whose caret is in today's entry, or where today's
 * begins (made with its first words, not before). The address /today does it, so the palette, the
 * shelf and the desktop menu all can.
 */
export function TodayPage({ novelId }: { novelId: string }) {
  const navigate = useNavigate();
  useEffect(() => void navigate(`/novels/${novelId}/read`, { replace: true }), [novelId, navigate]);
  return null;
}
