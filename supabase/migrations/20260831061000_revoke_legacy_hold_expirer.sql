-- Esta función de compatibilidad quedó fuera del flujo actual, pero su versión
-- hospedada era SECURITY DEFINER y conservaba EXECUTE para authenticated. Podía
-- recorrer y archivar reservas retenidas de todos los consultorios desde un RPC
-- directo. El scheduler actual no la usa: los turnos vigentes se gestionan por
-- las funciones internas autorizadas. Se conserva la función para no romper el
-- historial, pero se cierra su superficie pública.
revoke all on function public.expire_public_booking_holds() from public, anon, authenticated;

notify pgrst, 'reload schema';
