import React from "react";

// 完整标识保留在DOM中；前半段可省略，末8个Unicode字符始终可辨认。
export function IdentifierText({ value }: { value?: string }) {
  const characters = Array.from(value ?? "");
  return (
    <>
      <span>{characters.slice(0, -8).join("")}</span>
      <span>{characters.slice(-8).join("")}</span>
    </>
  );
}
