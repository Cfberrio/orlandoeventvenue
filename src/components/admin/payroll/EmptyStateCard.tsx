import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { AlertCircle, LucideIcon } from "lucide-react";

interface EmptyStateCardProps {
  title: string;
  description: string;
  actionText?: string;
  actionLink?: string;
  icon?: LucideIcon;
}

export function EmptyStateCard({ 
  title, 
  description, 
  actionText, 
  actionLink,
  icon: Icon = AlertCircle 
}: EmptyStateCardProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>
      {actionText && actionLink && (
        <Button asChild variant="outline">
          <Link to={actionLink}>{actionText}</Link>
        </Button>
      )}
    </div>
  );
}
