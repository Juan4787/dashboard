const dateFormatter = new Intl.DateTimeFormat('es-AR', {
	day: '2-digit',
	month: 'short',
	year: 'numeric'
});

const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});

export const formatDate = (value?: string | null) => {
	if (!value) return '';
	return dateFormatter.format(new Date(value));
};

export const formatDateTime = (value?: string | null) => {
	if (!value) return '';
	return dateTimeFormatter.format(new Date(value));
};

export const normalizePhone = (phone: string) => phone.replace(/\D/g, '');
