import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg mx-4 shadow-sm border-border bg-card">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-accent rounded-full" />
              <AlertCircle className="relative h-12 w-12 text-accent-foreground" />
            </div>
          </div>

          <h1 className="aiflow-type-display mb-2 font-bold text-foreground">
            404
          </h1>

          <h2 className="aiflow-type-page-title mb-4 font-semibold text-foreground">
            页面未找到
          </h2>

          <p className="aiflow-type-body mb-8 text-muted-foreground">
            请检查页面地址，或返回工作空间继续操作。
            <br />
          </p>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="px-6"
            >
              <Home className="w-4 h-4 mr-2" />
              返回工作空间
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
