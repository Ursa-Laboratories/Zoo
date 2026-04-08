import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { boardApi } from "../api/client";
import type { BoardConfig, InstrumentSchemas } from "../types";

type SaveBoardArgs = {
  filename: string;
  body: BoardConfig;
};

export function useBoardConfigs() {
  return useQuery({ queryKey: ["board", "configs"], queryFn: boardApi.listConfigs });
}

export function useInstrumentTypes() {
  return useQuery({
    queryKey: ["board", "instrument-types"],
    queryFn: boardApi.listInstrumentTypes,
    staleTime: Infinity,
  });
}

export function usePipetteModels() {
  return useQuery({
    queryKey: ["board", "pipette-models"],
    queryFn: boardApi.listPipetteModels,
    staleTime: Infinity,
  });
}

export function useInstrumentSchemas() {
  return useQuery<InstrumentSchemas>({
    queryKey: ["board", "instrument-schemas"],
    queryFn: boardApi.getInstrumentSchemas,
    staleTime: Infinity,
  });
}

export function useBoard(filename: string | null) {
  return useQuery({
    queryKey: ["board", filename],
    queryFn: () => boardApi.get(filename!),
    enabled: !!filename,
  });
}

export function useSaveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, body }: SaveBoardArgs) => boardApi.put(filename, body),
    onSuccess: (data, { filename }) => {
      qc.setQueryData(["board", filename], data);
      qc.invalidateQueries({ queryKey: ["board", "configs"] });
      qc.invalidateQueries({ queryKey: ["board", filename] });
    },
  });
}
