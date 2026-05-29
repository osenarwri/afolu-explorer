"use client";

import { useCallback } from "react";
import type { Dataset, HexFeature } from "@/lib/schema";
import { fluxTotal, stocksTotal } from "@/lib/data";
import type { PieceTooltip } from "@/lib/tooltip";
import { StocksTotem } from "./totems/StocksTotem";
import { FluxesTotem } from "./totems/FluxesTotem";

interface Props {
  hex: HexFeature;
  manifest: Dataset["manifest"];
  globalMaxStock: number;
  globalAbsMaxFluxComponent: number;
  globalAbsMaxNet: number;
  onClose: () => void;
  onPieceHover: (t: PieceTooltip, e: React.MouseEvent) => void;
  onPieceLeave: () => void;
}

export function HexDetailBox({
  hex,
  manifest,
  globalMaxStock,
  globalAbsMaxFluxComponent,
  globalAbsMaxNet,
  onClose,
  onPieceHover,
  onPieceLeave,
}: Props) {
  const stockTot = stocksTotal(hex, manifest.stocks);
  const fluxTot = fluxTotal(hex, manifest.fluxes);
  const stocksUnits = manifest.stocks[0]?.units ?? "";
  const netLayer = manifest.fluxes.find((l) => l.group === "net");
  const fluxUnits = netLayer?.units ?? manifest.fluxes[0]?.units ?? "";

  const enrichedHover = useCallback(
    (t: PieceTooltip, e: React.MouseEvent) => {
      const extras =
        t.kind === "stock"
          ? { totalStocks: stockTot, totalStocksUnits: stocksUnits }
          : { netFlux: fluxTot, netFluxUnits: fluxUnits };
      onPieceHover({ ...t, ...extras }, e);
    },
    [onPieceHover, stockTot, stocksUnits, fluxTot, fluxUnits]
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: "0",
        background: "rgba(40, 18, 56, 0.55)",
        backdropFilter: "blur(2px)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-purple)",
          border: "none",
          borderRadius: 14,
          padding: "28px 32px 36px",
          width: 560,
          minHeight: 560,
          color: "var(--color-text)",
          boxShadow: "0 22px 56px rgba(0,0,0,0.55)",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 14,
            background: "transparent",
            border: "none",
            color: "var(--color-text-soft)",
            fontSize: "1.4rem",
            lineHeight: 1,
            cursor: "pointer",
            padding: 4,
          }}
        >
          ×
        </button>

        <div
          style={{
            textAlign: "center",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontSize: "0.8rem",
            color: "var(--color-text)",
            marginBottom: 4,
          }}
        >
          {hex.hex_id}
        </div>
        {(() => {
          const subtitle = [hex.country, hex.admin1 !== "—" ? hex.admin1 : null]
            .filter(Boolean)
            .join(" · ");
          // Skip when it would just repeat the title (e.g. country-level cards).
          if (!subtitle || subtitle === hex.hex_id) return null;
          return (
            <div
              style={{
                textAlign: "center",
                fontSize: "0.78rem",
                color: "var(--color-text-soft)",
                marginBottom: 20,
              }}
            >
              {subtitle}
            </div>
          );
        })()}

        {/* Header row: totals above each totem */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 32,
            marginBottom: 16,
          }}
        >
          <HeaderBlock
            label="Total stocks"
            value={stockTot}
            units={stocksUnits}
            color="var(--color-teal)"
          />
          <HeaderBlock
            label="Net flux"
            value={fluxTot}
            units={fluxUnits}
            color={fluxTot >= 0 ? "var(--color-pink)" : "var(--color-teal)"}
            signed
          />
        </div>

        {/* Two columns: stocks (totem + per-pool breakdown) on the left,
            fluxes (totem + per-component breakdown) on the right. */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              minWidth: 0,
            }}
          >
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <StocksTotem
                hex={hex}
                layers={manifest.stocks}
                globalMax={globalMaxStock}
                width={96}
                topSkewRatio={0.14}
                gapRatio={0.12}
                strokeWidth={2}
                cornerRadius={5}
                onPieceHover={enrichedHover}
                onPieceLeave={onPieceLeave}
              />
            </div>
            <div>
              {manifest.stocks.map((l) => (
                <MetricRow
                  key={l.key}
                  label={l.label}
                  value={hex.stocks[l.key] ?? 0}
                  units={l.units}
                  color="var(--color-teal)"
                />
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              minWidth: 0,
            }}
          >
            <div
              style={{
                height: 220,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FluxesTotem
                hex={hex}
                layers={manifest.fluxes}
                globalAbsMax={globalAbsMaxFluxComponent}
                globalAbsMaxNet={globalAbsMaxNet}
                width={96}
                peakRatio={0.22}
                gapRatio={0.18}
                strokeWidth={2}
                cornerRadius={5}
                zeroAnchor="center"
                onPieceHover={enrichedHover}
                onPieceLeave={onPieceLeave}
              />
            </div>
            <div>
              {manifest.fluxes
                .filter((l) => l.group !== "net")
                .map((l) => (
                  <MetricRow
                    key={l.key}
                    label={l.label}
                    value={hex.fluxes[l.key] ?? 0}
                    units={l.units}
                    color={
                      l.group === "emissions"
                        ? "var(--color-pink)"
                        : "var(--color-teal)"
                    }
                  />
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderBlock({
  label,
  value,
  units,
  color,
  signed,
}: {
  label: string;
  value: number;
  units: string;
  color: string;
  signed?: boolean;
}) {
  const sign = signed && value > 0 ? "+" : value < 0 ? "−" : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          fontSize: "0.6rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-text-soft)",
        }}
      >
        {label}
      </div>
      <div style={{ color, fontWeight: 600, fontSize: "1.05rem" }}>
        {sign}
        {Math.abs(value).toFixed(2)}
      </div>
      <div
        style={{
          fontSize: "0.6rem",
          color: "var(--color-text-mute)",
          textAlign: "center",
        }}
      >
        {units}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  units,
  color,
}: {
  label: string;
  value: number;
  units: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 10,
        padding: "3px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: 2,
            border: `1.5px solid ${color}`,
            background: "transparent",
            flex: "0 0 auto",
          }}
        />
        <span
          style={{
            fontSize: "0.64rem",
            color: "var(--color-text-soft)",
            letterSpacing: "0.03em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: "0.68rem",
          color: "var(--color-text)",
          fontWeight: 500,
          whiteSpace: "nowrap",
        }}
      >
        {value.toFixed(2)}{" "}
        <span style={{ color: "var(--color-text-mute)", fontWeight: 400 }}>
          {units}
        </span>
      </span>
    </div>
  );
}
