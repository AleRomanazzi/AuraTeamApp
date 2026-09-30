import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Field from "../ui/Field";
import Modal from "../ui/Modal";
import QueryState from "../ui/QueryState";
import { useClientes, usePersonas } from "../../hooks/useData";
import { api, getList } from "../../lib/api";
import {
  DIAS_SEMANA,
  ETIQUETAS_TAREA,
  PRIORIDADES,
  labelDe,
} from "../../lib/constants";
import { notify, notifyError } from "../../lib/notify";
import { QK, TAREAS, invalidar } from "../../lib/queryKeys";
import { confirmar } from "../../store/confirmStore";

const VACIA = {
  titulo: "",
  descripcion: "",
  cliente: "",
  personas: [],
  dias: [0, 1, 2, 3, 4, 5],
  por_dia: 1,
  etiqueta: "historias",
  prioridad: "media",
  activa: true,
};

const diasTexto = (dias) =>
  dias.length === 7
    ? "todos los días"
    : dias.map((d) => DIAS_SEMANA[d]).join(" · ");

/** Plantillas que generan solas sus tareas (solo admin). */
export default function RecurrentesModal({ onClose }) {
  const qc = useQueryClient();
  const { data: clientes = [] } = useClientes();
  const { data: personas = [] } = usePersonas();
  const q = useQuery({
    queryKey: QK.recurrentes,
    queryFn: () => getList("tareas-recurrentes/"),
  });
  const [f, setF] = useState(null);

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const alternar = (k, v) =>
    setF((s) => ({
      ...s,
      [k]: s[k].includes(v) ? s[k].filter((x) => x !== v) : [...s[k], v],
    }));
  const refrescar = () => invalidar(qc, ["tareas-recurrentes", ...TAREAS]);

  const guardar = useMutation({
    mutationFn: (datos) => {
      const body = {
        ...datos,
        cliente: datos.cliente || null,
        por_dia: Number(datos.por_dia),
      };
      return datos.id
        ? api.put(`tareas-recurrentes/${datos.id}/`, body)
        : api.post("tareas-recurrentes/", body);
    },
    onSuccess: (_, datos) => {
      refrescar();
      notify(
        datos.id
          ? "Plantilla actualizada"
          : "Plantilla creada: ya se generaron las tareas de la semana",
      );
      setF(null);
    },
    onError: (e) => notifyError(e, "No se pudo guardar la plantilla"),
  });

  const activar = useMutation({
    mutationFn: (p) =>
      api.patch(`tareas-recurrentes/${p.id}/`, { activa: !p.activa }),
    onSuccess: refrescar,
    onError: (e) => notifyError(e),
  });

  const borrar = useMutation({
    mutationFn: (p) => api.delete(`tareas-recurrentes/${p.id}/`),
    onSuccess: () => {
      refrescar();
      notify("Plantilla eliminada");
      setF(null);
    },
    onError: (e) => notifyError(e),
  });

  if (f) {
    const editando = Boolean(f.id);
    return (
      <Modal
        title={editando ? "Editar recurrente" : "Nueva recurrente"}
        onClose={() => setF(null)}
        size="lg"
        onSubmit={() => guardar.mutate(f)}
        footer={
          <>
            {editando ? (
              <button
                type="button"
                className="btn btn-danger btn-sm modal-footer-start"
                disabled={borrar.isPending}
                onClick={async () =>
                  (await confirmar({
                    mensaje: `¿Eliminar la plantilla «${f.titulo}»? Las tareas que ya generó se mantienen.`,
                    peligro: true,
                    confirmar: "Eliminar",
                  })) && borrar.mutate(f)
                }
              >
                Eliminar
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setF(null)}
            >
              Volver
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={guardar.isPending || !f.dias.length}
            >
              {guardar.isPending ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        <Field
          label="Título"
          hint={
            Number(f.por_dia) > 1
              ? `Cada tarea se numera: «${f.titulo || "Título"} 1/${f.por_dia}», «2/${f.por_dia}»…`
              : null
          }
        >
          <input
            value={f.titulo}
            onChange={set("titulo")}
            required
            maxLength={180}
            placeholder="Cycles · Historia"
          />
        </Field>
        <div className="grid-2 tight">
          <Field label="Cliente">
            <select value={f.cliente ?? ""} onChange={set("cliente")}>
              <option value="">Sin cliente</option>
              {clientes
                .filter(
                  (c) => c.estado !== "baja" || c.id === Number(f.cliente),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Tareas por día">
            <input
              type="number"
              min={1}
              max={10}
              value={f.por_dia}
              onChange={set("por_dia")}
              required
            />
          </Field>
          <Field label="Calendario">
            <select value={f.etiqueta} onChange={set("etiqueta")}>
              {ETIQUETAS_TAREA.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Prioridad">
            <select value={f.prioridad} onChange={set("prioridad")}>
              {PRIORIDADES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Días">
          <div className="chip-select">
            {DIAS_SEMANA.map((d, i) => (
              <button
                key={d}
                type="button"
                className={`chip${f.dias.includes(i) ? " active" : ""}`}
                aria-pressed={f.dias.includes(i)}
                onClick={() => alternar("dias", i)}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Responsables">
          <div className="chip-select">
            {personas
              .filter((p) => p.activo || f.personas.includes(p.id))
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip${f.personas.includes(p.id) ? " active" : ""}`}
                  aria-pressed={f.personas.includes(p.id)}
                  onClick={() => alternar("personas", p.id)}
                >
                  {p.nombre}
                </button>
              ))}
          </div>
        </Field>
        <Field label="Descripción">
          <textarea
            rows={3}
            value={f.descripcion}
            onChange={set("descripcion")}
            placeholder="Qué incluye cada tarea…"
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={f.activa}
            onChange={(e) => setF((s) => ({ ...s, activa: e.target.checked }))}
          />
          Activa
        </label>
        <p className="muted small">
          Las tareas se crean solas con una semana de anticipación. Los cambios
          valen para las que se generen de ahora en más.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Tareas recurrentes"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setF({ ...VACIA })}
          >
            + Nueva recurrente
          </button>
        </>
      }
    >
      <QueryState query={q} vacio="Todavía no hay tareas recurrentes.">
        {(lista) => (
          <div className="recurrentes">
            {lista.map((p) => (
              <div
                key={p.id}
                className={`recurrente${p.activa ? "" : " recurrente--pausada"}`}
              >
                <span
                  className="cat-dot"
                  style={{ background: p.cliente_color || "var(--text-dim)" }}
                />
                <button
                  type="button"
                  className="recurrente-main"
                  onClick={() =>
                    setF({ ...VACIA, ...p, cliente: p.cliente ?? "" })
                  }
                >
                  <strong>{p.titulo}</strong>
                  <span className="muted small">
                    {p.por_dia} por día · {diasTexto(p.dias)} ·{" "}
                    {labelDe(ETIQUETAS_TAREA, p.etiqueta)}
                    {p.personas.length
                      ? ` · ${p.personas.map((id) => personas.find((x) => x.id === id)?.nombre ?? "?").join(", ")}`
                      : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={activar.isPending}
                  onClick={() => activar.mutate(p)}
                >
                  {p.activa ? "Pausar" : "Reanudar"}
                </button>
              </div>
            ))}
          </div>
        )}
      </QueryState>
    </Modal>
  );
}
