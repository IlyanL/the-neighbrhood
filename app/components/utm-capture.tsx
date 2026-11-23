"use client";

import { useEffect } from "react";
import { captureUtmParams } from "@/lib/attribution";

export function UtmCapture() {
  useEffect(() => {
    captureUtmParams();
  }, []);
  return null;
}
