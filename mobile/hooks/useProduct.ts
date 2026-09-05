import { useApi } from "@/lib/api";
import { Product } from "@/types";
import { useQuery } from "@tanstack/react-query";

export const useProduct = (productId: string) => {
  const api = useApi();

  const result = useQuery<Product>({
    queryKey: ["product", productId],
    queryFn: async () => {
      const { data } = await api.get(`/products/${productId}`);
      return data;
    },
    enabled: !!productId,
  });

  return result;
};